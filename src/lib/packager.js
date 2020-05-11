const
  { ObjectUtil } = require('mbjs-utils'),
  config = require('config'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri'),
  os = require('os'),
  fs = require('mz/fs'),
  path = require('path'),
  fsx = require('fs-extra'),
  yazl = require('yazl'),
  extractTemplate = require('./extract-template'),
  fetchMap = require('./fetch-map'),
  storeData = require('./store-data'),
  processTemplate = require('./process-template'),
  send = require('@polka/send-type'),
  Service = require('mbjs-generic-api/src/lib/service')

class Packager extends Service {
  constructor (api, config) {
    super('packager', api)

    const
      Minio = require('minio'),
      opts = Object.assign({}, config.assets.client)

    opts.useSSL = config.assets.client.secure && (config.assets.client.secure === true || config.assets.client.secure === 'true') ? true : false
    opts.port = config.assets.client.port ? parseInt(config.assets.client.port) : undefined

    this.config = config
    this.minio = new Minio.Client(opts)
    this.api = api

    api.app.post('/packages', (req, res) => this.postHandler(req, res))
  }

  async postHandler (req, res) {
    req.setTimeout(config.http.requestTimeoutSeconds * 1000)

    const { rootId } = req.body
    let archivePath, outDir, mapResults
    const requestConfig = {
      headers: {
        Authorization: req.headers.authorization
      }
    }

    try {
      mapResults = await fetchMap(rootId, {
        metadata: {},
        maps: [],
        files: [],
        cells: [],
        annotations: []
      }, requestConfig)
    }
    catch (err) {
      this.api.captureException(err)
      return send(res, 500, `fetchMap: ${err.message}`)
    }

    try {
      outDir = path.join(os.tmpdir(), ObjectUtil.uuid4())
      await fsx.ensureDir(outDir)

      let needsTemplateFetch = true

      if (needsTemplateFetch) {
        await this.minio.fGetObject(config.assets.packagesBucket, 'template.zip', path.join(os.tmpdir(), 'template.zip'))
      }
    }
    catch (err) {
      this.api.captureException(err)
      return send(res, 500, `fetchTemplate: ${err.message}`)
    }

    try {
      const templateEntries = await extractTemplate(path.join(os.tmpdir(), 'template.zip'), outDir)

      archivePath = `${outDir}.zip`
      const archive = new yazl.ZipFile()
      await processTemplate(outDir, rootId, templateEntries, mapResults, archive)
      await storeData(outDir, rootId, mapResults, archive, requestConfig)
      archive.end()

      await new Promise((resolve, reject) => {
        archive.outputStream.pipe(fs.createWriteStream(archivePath))
          .on('error', err => reject(err))
          .on('close', () => resolve())
      })
    }
    catch (err) {
      this.api.captureException(err)
      return send(res, 500, `createArchive: ${err.message}`)
    }

    try {
      await this.minio.fPutObject(config.assets.packagesBucket, `${parseURI(rootId).uuid}.zip`, archivePath, { 'Content-Type': 'application/zip' })
      await fs.unlink(archivePath)
      await fsx.remove(outDir)

      const url = await this.minio.presignedGetObject(config.assets.packagesBucket, `${parseURI(rootId).uuid}.zip`)
      send(res, 200, url)
    }
    catch (err) {
      this.api.captureException(err)
      return send(res, 500, `uploadArchive: ${err.message}`)
    }
  }
}

module.exports = Packager
