[parallel]
dev: dev-sample-fe dev-sample-express

dev-sample-fe:
  - LOG_PREFIX=sample-fe LOG_PREFIX_COLOR=36 npm run dev --workspace @pe-learning-path/sample-fe

dev-sample-express:
  - LOG_PREFIX=sample-express LOG_PREFIX_COLOR=32 npm run dev --workspace @pe-learning-path/sample-express
