/*
|--------------------------------------------------------------------------
| JavaScript entrypoint for running ace commands
|--------------------------------------------------------------------------
|
| DO NOT MODIFY THIS FILE AS IT WILL BE OVERRIDDEN DURING THE BUILD
| PROCESS.
|
| This file registers the TypeScript execution hook and then imports the
| "bin/console.ts" file.
|
*/

import '@poppinss/ts-exec'

await import('./bin/console.js')
