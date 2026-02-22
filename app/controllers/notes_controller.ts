import type { HttpContext } from '@adonisjs/core/http'
import Note from '#models/note'
import Subject from '#models/subject'
import { createNoteValidator, updateNoteValidator } from '#validators/note'

export default class NotesController {
  /**
   * Serialize a note into the API response shape.
   * Expects `user`, `subject`, and `likes` to be preloaded.
   */
  private serialize(note: Note, userId?: number) {
    const isLiked = userId
      ? note.likes.some((like) => like.userId === userId)
      : false

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
  async index({ params, request, response }: HttpContext) {
    const subjectId = params.id
    let limit = Number(request.input('limit', 15))
    if (!Number.isFinite(limit) || limit < 1) {
      limit = 10
    }

    const page = Number(request.input('page', 1))

    const notes = await Note.query()
      .where('subjectId', subjectId)
      .preload('user')
      .preload('subject')
      .preload('likes')
      .paginate(page, limit)

    // TODO: get authenticated user id when auth service is integrated
    const userId: number | undefined = undefined

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
  async store({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(createNoteValidator)

    // TODO: replace with auth middleware + admin check when auth service is integrated
    // if (!auth.user?.isAdmin) return response.unauthorized({ message: 'Unauthorized' })

    const subjectId = params.id

    // Verify the subject exists
    const subject = await Subject.find(subjectId)
    if (!subject) {
      return response.notFound({ message: 'Subject not found' })
    }

    // TODO: integrate storage service (Firebase or Supabase) to move file
    // from "uploaded/notes/{upload_id}" to "distribution/notes/{upload_id}"
    // and delete the original uploaded file.

    const note = await Note.create({
      uploadId: data.upload_id,
      title: data.title,
      description: data.description ?? null,
      nPages: data.n_pages ?? null,
      userId: data.author_id,
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
  async update({ params, request, response }: HttpContext) {
    // TODO: replace with auth middleware + admin check when auth service is integrated
    // if (!auth.user?.isAdmin) return response.unauthorized({ message: 'Unauthorized' })

    const data = await request.validateUsing(updateNoteValidator)
    const note = await Note.findOrFail(params.id)

    if (data.upload_id) {
      // TODO: integrate storage service (Firebase or Supabase) to move file
      // from "uploaded/notes/{upload_id}" to "distribution/notes/{upload_id}"
      // and delete the original uploaded file.
    }

    note.merge({
      title: data.title ?? note.title,
      description: data.description ?? note.description,
      userId: data.author_id ?? note.userId,
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
  async show({ params, response }: HttpContext) {
    const note = await Note.findOrFail(params.id)

    note.views = (note.views ?? 0) + 1
    await note.save()

    await note.load('user')
    await note.load('subject')
    await note.load('likes')

    // TODO: get authenticated user id when auth service is integrated
    const userId: number | undefined = undefined

    return response.ok(this.serialize(note, userId))
  }

  /**
   * Toggle like on a note.
   * POST /notes/:id/like
   */
  async like({ params, request, response }: HttpContext) {
    const note = await Note.findOrFail(params.id)

    // TODO: replace with auth user id when auth service is integrated
    const userId = request.input('user_id') as number

    const existingLike = await note
      .related('likes')
      .query()
      .where('userId', userId)
      .first()

    if (!existingLike) {
      await note.related('likes').create({ userId })
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
    const note = await Note.findOrFail(params.id)

    note.views = (note.views ?? 0) + 1
    await note.save()

    // If the note has a direct URL stored, return it
    if (note.url) {
      return response.ok({ url: note.url })
    }

    // TODO: integrate storage service (Firebase or Supabase) to generate
    // a signed download URL for "distribution/notes/{upload_id}"
    // with ~5 minute expiry.
    //
    // Example (Firebase):
    //   const url = await storageService.getSignedDownloadUrl(note.uploadId)
    //   return response.ok({ url })

    return response.serviceUnavailable({
      message: 'Storage service not yet configured. Please configure Firebase or Supabase.',
    })
  }
}
