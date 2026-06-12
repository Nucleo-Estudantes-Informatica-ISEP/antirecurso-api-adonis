/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const CommentsController = () => import('#controllers/comments_controller')
const ExamsController = () => import('#controllers/exams_controller')
const NotesController = () => import('#controllers/notes_controller')
const QuestionsController = () => import('#controllers/questions_controller')
const UploadsController = () => import('#controllers/uploads_controller')
const UsersController = () => import('#controllers/users_controller')

// Health check
router.get('/', async () => {
  return { status: 'ok' }
})

// Comments
// TODO: add auth middleware when auth service is integrated
router.get('/comments', [CommentsController, 'index'])
router.post('/comments', [CommentsController, 'store'])
router.get('/comments/:id', [CommentsController, 'show'])

// Questions
// TODO: add auth middleware when auth service is integrated
router.put('/questions/:id', [QuestionsController, 'update'])
router.get('/questions/:id', [QuestionsController, 'show'])

// Notes (public)
router.get('/subjects/:id/notes', [NotesController, 'index'])
router.get('/notes/:id', [NotesController, 'show'])
router.patch('/notes/:id', [NotesController, 'update']) // admin check in controller
router.post('/notes/:id/like', [NotesController, 'like'])

// Notes & Uploads (auth required)
// TODO: add auth middleware when auth service is integrated
router.post('/subjects/:id/notes', [NotesController, 'store']) // admin check in controller
router.post('/notes/:id/view', [NotesController, 'view'])
router.post('/upload', [UploadsController, 'upload'])

// Exams
// TODO: add auth middleware when auth service is integrated
router.get('/exams/generate/:subject_id', [ExamsController, 'generate'])
router.post('/exams/verify', [ExamsController, 'verify'])
router.get('/exams', [ExamsController, 'index'])
router.get('/exams/:id', [ExamsController, 'show'])
router.get('/exams/:id/review', [ExamsController, 'publicReview'])

// User (auth required)
// TODO: add auth middleware when auth service is integrated
router.get('/user', [UsersController, 'session'])
router.get('/user/scores', [UsersController, 'scores'])
router.get('/user/answers', [UsersController, 'answers'])

// Admin (auth + admin required)
// TODO: add auth middleware + admin policy when auth service is integrated
router.get('/search', [UsersController, 'search'])
router.get('/users', [UsersController, 'listUsers'])
router.get('/admin', [UsersController, 'adminSession'])
router.get('/admin/exams', [ExamsController, 'stats'])

