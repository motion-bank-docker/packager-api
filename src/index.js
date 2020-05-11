const
  config = require('config'),
  { version } = require('../package.json'),
  GenericAPI = require('mbjs-generic-api')

const setup = async function () {
  const api = new GenericAPI()
  await api.setup(version)

  /** Register middleware */

  const
    checkFeatures = require('mbjs-generic-api/src/middleware/check-features'),
    addCreator = require('mbjs-generic-api/src/middleware/creator')

  checkFeatures(api, ['packager'], ['get'])
  addCreator(api, config)

  /** Register resources */

  const
    Packager = require('./lib/packager'),
    packager = new Packager(api, config)
  // packager.on('message', message => api._sockets.write(message))

  await api.start()
}

setup().catch(err => {
  process.stderr.write(err.message + '\n')
  process.stderr.write(err.stack + '\n')
  process.exit(err.code)
})
