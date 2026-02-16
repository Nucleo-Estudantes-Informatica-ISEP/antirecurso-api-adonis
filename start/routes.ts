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
const QuestionsController = () => import('#controllers/questions_controller')
const QuestionReportsController = () => import('#controllers/question_reports_controller')

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

// Question Reports
// TODO: add auth middleware when auth service is integrated
router.get('/question-reports', [QuestionReportsController, 'index'])
router.post('/question-reports', [QuestionReportsController, 'store'])
router.get('/question-reports/:id', [QuestionReportsController, 'show'])
router.post('/question-reports/review', [QuestionReportsController, 'review'])

