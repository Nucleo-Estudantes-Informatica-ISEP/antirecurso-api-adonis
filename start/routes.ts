/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

const CommentsController = () => import('#controllers/comments_controller')
const ExamsController = () => import('#controllers/exams_controller')
const NotesController = () => import('#controllers/notes_controller')
const QuestionsController = () => import('#controllers/questions_controller')
const UploadsController = () => import('#controllers/uploads_controller')
const UsersController = () => import('#controllers/users_controller')
const SubjectsController = () => import('#controllers/subjects_controller')

// Health check
router.get('/', async () => {
  return { status: 'ok' }
})

// Subjects
router.get('/subjects', [SubjectsController, 'index'])
router.get('/subjects/:id', [SubjectsController, 'show'])
router.get('/subjects/:id/stats', [SubjectsController, 'stats']).use(middleware.auth())
router.get('/subjects/:id/scoreboard/:mode', [SubjectsController, 'scoreboard'])
router
  .post('/subjects/:id/scoreboard', [SubjectsController, 'scoreboardVisibility'])
  .use(middleware.auth())

// Comments
router.get('/comments', [CommentsController, 'index']).use(middleware.auth())
router.post('/comments', [CommentsController, 'store']).use(middleware.auth())
router.get('/comments/:id', [CommentsController, 'show']).use(middleware.auth())

// Questions
router.put('/questions/:id', [QuestionsController, 'update']).use([
  middleware.auth(),
  middleware.admin(),
])
router.get('/questions/:id', [QuestionsController, 'show'])

// Notes (public)
router.get('/subjects/:id/notes', [NotesController, 'index']).use(middleware.optionalAuth())
router.get('/notes/:id', [NotesController, 'show']).use(middleware.optionalAuth())
router.patch('/notes/:id', [NotesController, 'update']).use([
  middleware.auth(),
  middleware.admin(),
])
router.post('/notes/:id/like', [NotesController, 'like']).use(middleware.auth())

// Notes & Uploads (auth required)
router.post('/subjects/:id/notes', [NotesController, 'store']).use([
  middleware.auth(),
  middleware.admin(),
])
router.post('/notes/:id/view', [NotesController, 'view']).use(middleware.auth())
router.post('/upload', [UploadsController, 'upload']).use(middleware.auth())

// Exams
router.get('/exams/generate/:subject_id', [ExamsController, 'generate']).use(middleware.optionalAuth())
router.post('/exams/verify', [ExamsController, 'verify']).use(middleware.optionalAuth())
router.get('/exams', [ExamsController, 'index']).use(middleware.auth())
router.get('/exams/:id', [ExamsController, 'show']).use(middleware.auth())

// User (auth required)
router.get('/user', [UsersController, 'session']).use(middleware.auth())
router.get('/user/scores', [UsersController, 'scores']).use(middleware.auth())
router.get('/user/answers', [UsersController, 'answers']).use(middleware.auth())

// Admin (auth + admin required)
router.get('/search', [UsersController, 'search']).use([middleware.auth(), middleware.admin()])
router.get('/users', [UsersController, 'listUsers']).use([middleware.auth(), middleware.admin()])
router.get('/admin', [UsersController, 'adminSession']).use([middleware.auth(), middleware.admin()])
router.get('/admin/exams', [ExamsController, 'stats']).use([middleware.auth(), middleware.admin()])
