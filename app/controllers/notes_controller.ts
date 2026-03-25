import type { HttpContext } from '@adonisjs/core/http'
import Like from '#models/like'
import Note from '#models/note'
import Subject from '#models/subject'
import { createNoteValidator, updateNoteValidator } from '#validators/note'
import StorageService, {
  StorageNotConfiguredError,
  StorageObjectNotFoundError,
  StorageRequestError,
} from '#services/storage_service'

const storageService = new StorageService()

export default class NotesController {
  /**
   * Serialize a note into the API response shape.
   * Expects `user`, `subject`, and `likes` to be preloaded.
   */
  private serialize(note: Note, userId?: number) {
    const isLiked = userId ? note.likes.some((like) => like.userId === userId) : false

    return {
      id: note.id,
      title: note.title,
      url: note.url,
      views: note.views ?? 0,
      user: {
        id: note.user.id,
        name: note.user.name,
      },
      description: note.description,
      n_pages: note.nPages,
      subject: {
        id: note.subject.id,
        name: note.subject.name,
        slug: note.subject.slug,
      },
      likes: note.likes.length,
      is_liked: isLiked,
      created_at: note.createdAt.toISO(),
      upload_id: note.uploadId,
    }
  }

  /**
   * Paginated list of notes for a subject.
   * GET /subjects/:id/notes
   */
  async index({ authUser, params, request, response }: HttpContext) {
    const subjectId = Number(params.id)
    if (!Number.isFinite(subjectId)) {
      return response.badRequest({ message: 'Invalid subject id' })
    }

    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Subject not found' })
    }

    let limit = Number(request.input('limit', 15))
    if (!Number.isFinite(limit) || limit < 1) {
      limit = 15
    }
    limit = Math.min(limit, 100)

    let page = Number(request.input('page', 1))
    if (!Number.isFinite(page) || page < 1) {
      page = 1
    }

    const notes = await Note.query()
      .where('subjectId', subjectId)
      .preload('user')
      .preload('subject')
      .preload('likes')
      .paginate(page, limit)

    const userId = authUser?.id

    return response.ok({
      meta: notes.getMeta(),
      data: notes.all().map((note) => this.serialize(note, userId)),
    })
  }

  /**
   * Create a new note (admin only).
   * Moves the uploaded file from the temp path to the distribution path.
   * POST /subjects/:id/notes
   */
  async store({ authUser, params, request, response }: HttpContext) {
    const data = await request.validateUsing(createNoteValidator)
    if (!authUser?.isAdmin) {
      return response.forbidden({ message: 'You are not an admin' })
    }

    const subjectId = Number(params.id)
    if (!Number.isFinite(subjectId)) {
      return response.badRequest({ message: 'Invalid subject id' })
    }
    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Subject not found' })
    }

    try {
      await storageService.promoteUploadedNote(data.upload_id)
    } catch (error) {
      return this.handleStorageError(error, response, 'Invalid upload id')
    }

    const note = await Note.create({
      uploadId: data.upload_id,
      title: data.title,
      description: data.description ?? null,
      nPages: data.n_pages ?? null,
      userId: authUser.id,
      subjectId: subjectId,
    })

    await note.load('user')
    await note.load('subject')
    await note.load('likes')

    return response.created(this.serialize(note))
  }

  /**
   * Update an existing note (admin only).
   * PATCH /notes/:id
   */
  async update({ authUser, params, request, response }: HttpContext) {
    if (!authUser?.isAdmin) {
      return response.forbidden({ message: 'You are not an admin' })
    }

    const data = await request.validateUsing(updateNoteValidator)
    const note = await Note.findOrFail(params.id)

    if (data.upload_id) {
      try {
        await storageService.promoteUploadedNote(data.upload_id)
      } catch (error) {
        return this.handleStorageError(error, response, 'Invalid upload id')
      }
    }

    note.merge({
      title: data.title ?? note.title,
      description: data.description ?? note.description,
      subjectId: data.subject_id ?? note.subjectId,
      uploadId: data.upload_id ?? note.uploadId,
      nPages: data.n_pages ?? note.nPages,
    })

    await note.save()
    await note.load('user')
    await note.load('subject')
    await note.load('likes')

    return response.ok(this.serialize(note))
  }

  /**
   * Show a single note and increment views.
   * GET /notes/:id
   */
  async show({ authUser, params, response }: HttpContext) {
    await Note.query().where('id', params.id).increment('views', 1)
    const note = await Note.findOrFail(params.id)

    await note.load('user')
    await note.load('subject')
    await note.load('likes')

    const userId = authUser?.id

    return response.ok(this.serialize(note, userId))
  }

  /**
   * Toggle like on a note.
   * POST /notes/:id/like
   */
  async like({ authUser, params, response }: HttpContext) {
    const note = await Note.findOrFail(params.id)
    const userId = authUser?.id
    if (!userId) {
      return response.unauthorized({ message: 'Authentication required' })
    }

    const existingLike = await Like.query().where('noteId', note.id).where('userId', userId).first()

    if (!existingLike) {
      try {
        await Like.create({ noteId: note.id, userId })
      } catch (error: any) {
        if (error.code !== '23505') {
          throw error
        }
      }
    } else {
      await existingLike.delete()
    }

    await note.load('user')
    await note.load('subject')
    await note.load('likes')

    return response.ok(this.serialize(note, userId))
  }

  /**
   * Increment views and return a signed URL for viewing the note's file.
   * POST /notes/:id/view
   */
  async view({ params, response }: HttpContext) {
    await Note.query().where('id', params.id).increment('views', 1)
    const note = await Note.findOrFail(params.id)

    // If the note has a direct URL stored, return it
    if (note.url) {
      return response.ok({ url: note.url })
    }

    if (!note.uploadId) {
      return response.notFound({ message: 'No file available for this note' })
    }

    try {
      const url = await storageService.createSignedDownloadUrl(
        storageService.buildDistributionPath('notes', note.uploadId)
      )

      return response.ok({ url })
    } catch (error) {
      return this.handleStorageError(error, response, 'File not found')
    }
  }

  private handleStorageError(
    error: unknown,
    response: HttpContext['response'],
    notFoundMessage: string
  ) {
    if (error instanceof StorageNotConfiguredError) {
      return response.serviceUnavailable({ message: error.message })
    }

    if (error instanceof StorageObjectNotFoundError) {
      return response.badRequest({ message: notFoundMessage })
    }

    if (error instanceof StorageRequestError) {
      if (error.status === 400 || error.status === 404) {
        return response.badRequest({ message: notFoundMessage })
      }

      return response.internalServerError({ message: error.message, status: error.status })
    }

    throw error
  }
}
