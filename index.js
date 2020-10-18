const http = require('http')
const next = require('next')
const fs = require('fs')

const app = next({dev: true})
const handler = app.getRequestHandler()

const server = http.createServer(handler);
server.listen(80)