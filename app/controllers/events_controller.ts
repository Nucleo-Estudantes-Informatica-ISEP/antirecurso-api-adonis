import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Event from '#models/event'
import { createEventValidator, updateEventValidator } from '#validators/event'

export default class EventsController {
  private serialize(event: Event) {
    return {
      id: event.id,
      name: event.name,
      description: event.description,
      start_date: event.startDate.toISODate(),
      end_date: event.endDate.toISODate(),
      created_at: event.createdAt.toISO(),
      updated_at: event.updatedAt.toISO(),
    }
  }

  async index({ request, response }: HttpContext) {
    let page = Number(request.input('page', 1))
    if (!Number.isFinite(page) || page < 1) {
      page = 1
    }

    let limit = Number(request.input('limit', 15))
    if (!Number.isFinite(limit) || limit < 1) {
      limit = 15
    }
    limit = Math.min(limit, 100)

    const events = await Event.query().orderBy('start_date', 'desc').paginate(page, limit)

    return response.ok({
      meta: events.getMeta(),
      data: events.all().map((item) => this.serialize(item)),
    })
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createEventValidator)

    const event = await Event.create({
      name: data.name,
      description: data.description?.trim() ? data.description : null,
      startDate: DateTime.fromJSDate(data.start_date),
      endDate: DateTime.fromJSDate(data.end_date),
    })

    return response.created(this.serialize(event))
  }

  async update({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(updateEventValidator)
    const event = await Event.findOrFail(params.id)

    const nextStartDate = data.start_date
      ? DateTime.fromJSDate(data.start_date)
      : event.startDate
    const nextEndDate = data.end_date ? DateTime.fromJSDate(data.end_date) : event.endDate

    if (nextEndDate < nextStartDate) {
      return response.badRequest({ message: 'End date must be after or equal to start date' })
    }

    event.merge({
      name: data.name ?? event.name,
      description:
        data.description !== undefined
          ? data.description.trim()
            ? data.description
            : null
          : event.description,
      startDate: nextStartDate,
      endDate: nextEndDate,
    })

    await event.save()

    return response.ok(this.serialize(event))
  }

  async destroy({ params, response }: HttpContext) {
    const event = await Event.findOrFail(params.id)
    await event.delete()

    return response.noContent()
  }
}
