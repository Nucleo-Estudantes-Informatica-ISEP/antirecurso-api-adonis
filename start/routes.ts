/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import CommentsController from '#controllers/comments_controller'
import EventsController from '#controllers/events_controller'
import ExamsController from '#controllers/exams_controller'
import NotesController from '#controllers/notes_controller'
import QuestionsController from '#controllers/questions_controller'
import QuestionReportsController from '#controllers/question_reports_controller'
import UploadsController from '#controllers/uploads_controller'
import UsersController from '#controllers/users_controller'
import SubjectsController from '#controllers/subjects_controller'
import type { AuthenticatedHttpContext } from '../contracts/auth.js'
import { middleware } from './kernel.js'

const commentsController = new CommentsController()
const eventsController = new EventsController()
const examsController = new ExamsController()
const notesController = new NotesController()
const questionsController = new QuestionsController()
const questionReportsController = new QuestionReportsController()
const uploadsController = new UploadsController()
const usersController = new UsersController()
const subjectsController = new SubjectsController()

// Health check
router.get('/', async () => {
  return { status: 'ok' }
})

// Subjects
router.get('/subjects', (ctx) => subjectsController.index(ctx))
router.get('/subjects/:id', (ctx) => subjectsController.show(ctx))
router
  .get('/subjects/:id/stats', (ctx) => subjectsController.stats(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())
router.get('/subjects/:id/scoreboard/:mode', (ctx) => subjectsController.scoreboard(ctx))
router
  .post('/subjects/:id/scoreboard', (ctx) =>
    subjectsController.scoreboardVisibility(ctx as AuthenticatedHttpContext)
  )
  .use(middleware.auth())

// Comments
router.get('/comments', (ctx) => commentsController.index(ctx)).use(middleware.auth())
router
  .post('/comments', (ctx) => commentsController.store(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())
router.get('/comments/:id', (ctx) => commentsController.show(ctx)).use(middleware.auth())

// Questions
router
  .put('/questions/:id', (ctx) => questionsController.update(ctx))
  .use([middleware.auth(), middleware.admin()])
router.get('/questions/:id', (ctx) => questionsController.show(ctx))

// Question reports
router
  .post('/question-reports', (ctx) =>
    questionReportsController.store(ctx as AuthenticatedHttpContext)
  )
  .use(middleware.auth())

// Notes (public)
router
  .get('/subjects/:id/notes', (ctx) => notesController.index(ctx))
  .use(middleware.optionalAuth())
router.get('/notes/:id', (ctx) => notesController.show(ctx)).use(middleware.optionalAuth())
router
  .patch('/notes/:id', (ctx) => notesController.update(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .delete('/notes/:id', (ctx) => notesController.destroy(ctx))
  .use([middleware.auth(), middleware.admin()])
router.post('/notes/:id/like', (ctx) => notesController.like(ctx)).use(middleware.auth())

// Notes & Uploads (auth required)
router
  .post('/subjects/:id/notes', (ctx) => notesController.store(ctx))
  .use([middleware.auth(), middleware.admin()])
router.post('/notes/:id/view', (ctx) => notesController.view(ctx)).use(middleware.auth())
router.post('/upload', (ctx) => uploadsController.upload(ctx)).use(middleware.auth())

// Exams
router
  .get('/exams/generate/:subject_id', (ctx) => examsController.generate(ctx))
  .use(middleware.optionalAuth())
router.post('/exams/verify', (ctx) => examsController.verify(ctx)).use(middleware.optionalAuth())
router
  .get('/exams', (ctx) => examsController.index(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())
router
  .get('/exams/:id', (ctx) => examsController.show(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())

// User (auth required)
router
  .get('/user', (ctx) => usersController.session(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())
router
  .get('/user/scores', (ctx) => usersController.scores(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())
router
  .get('/user/answers', (ctx) => usersController.answers(ctx as AuthenticatedHttpContext))
  .use(middleware.auth())

// Admin (auth + admin required)
router
  .get('/search', (ctx) => usersController.search(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .get('/users', (ctx) => usersController.listUsers(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .get('/admin', (ctx) => usersController.adminSession(ctx as AuthenticatedHttpContext))
  .use([middleware.auth(), middleware.admin()])
router
  .get('/admin/exams', (ctx) => examsController.stats(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .get('/events', (ctx) => eventsController.index(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .post('/events/new', (ctx) => eventsController.store(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .patch('/events/:id', (ctx) => eventsController.update(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .delete('/events/:id', (ctx) => eventsController.destroy(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .get('/question-reports', (ctx) => questionReportsController.index(ctx))
  .use([middleware.auth(), middleware.admin()])
router
  .post('/question-reports/review', (ctx) =>
    questionReportsController.review(ctx as AuthenticatedHttpContext)
  )
  .use([middleware.auth(), middleware.admin()])
router
  .get('/question-reports/:id', (ctx) => questionReportsController.show(ctx))
  .use([middleware.auth(), middleware.admin()])
