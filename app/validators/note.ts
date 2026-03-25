import vine from '@vinejs/vine'

/**
 * Validator for creating a note.
 */
export const createNoteValidator = vine.compile(
  vine.object({
    upload_id: vine.string().minLength(1),
    title: vine.string().minLength(1),
    description: vine.string().minLength(1).optional(),
    n_pages: vine.number().optional(),
  })
)

/**
 * Validator for updating a note.
 */
export const updateNoteValidator = vine.compile(
  vine.object({
    upload_id: vine.string().minLength(1).optional(),
    subject_id: vine.number().optional(),
    title: vine.string().minLength(1).optional(),
    description: vine.string().minLength(1).optional(),
    n_pages: vine.number().optional(),
  })
)
