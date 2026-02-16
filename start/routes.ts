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
const QuestionsController = () => import('#controllers/questions_controller')

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

// Exams
// TODO: add auth middleware when auth service is integrated
router.get('/exams/generate/:subject_id', [ExamsController, 'generate'])
router.post('/exams/verify', [ExamsController, 'verify'])
router.get('/exams', [ExamsController, 'index'])
router.get('/exams/:id', [ExamsController, 'show'])

// Admin
// TODO: add auth middleware + admin policy when auth service is integrated
router.get('/admin/exams', [ExamsController, 'stats'])
