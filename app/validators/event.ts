import vine from '@vinejs/vine'

const dateFormats = ['YYYY-MM-DD']

export const createEventValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2),
    description: vine.string().trim().optional(),
    start_date: vine.date({ formats: dateFormats }),
    end_date: vine.date({ formats: dateFormats }).afterOrSameAs('start_date'),
  })
)

export const updateEventValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).optional(),
    description: vine.string().trim().optional(),
    start_date: vine.date({ formats: dateFormats }).optional(),
    end_date: vine.date({ formats: dateFormats }).optional(),
  })
)
