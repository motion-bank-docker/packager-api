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
    super('assets', api)

    const
      _this = this,
      Minio = require('minio'),
      opts = Object.assign({}, config.assets.client)

    opts.secure = config.assets.client.secure && (config.assets.client.secure === true || config.assets.client.secure === 'true')
    opts.port = config.assets.client.port ? parseInt(config.assets.client.port) : undefined

    _this.config = config
    _this.minio = new Minio.Client(opts)

    api.app.post('/packages', (req, res) => _this.postHandler(req, res))
  }

  async postHandler (req, res) {
    req.setTimeout(config.http.requestTimeoutSeconds * 1000)

    const rootUuid = parseURI(req.body.id).uuid
    const requestConfig = {
      headers: {
        Authorization: req.headers.authorization
      }
    }
    const mapResults = await fetchMap(rootUuid, {
      metadata: {},
      maps: [],
      files: [],
      annotations: {
        gridMetadata: [],
        cells: [],
        data: []
      }
    }, requestConfig)

    const outDir = path.join(os.tmpdir(), ObjectUtil.uuid4())
    await fsx.ensureDir(outDir)

    let needsTemplateFetch = true

    // try {
    //   const stats = fs.stat(path.join(os.tmpdir(), 'template.zip'))
    //   if (stats.isFile() && Date.now() - stats.mtimeMs < 3600000) needsTemplateFetch = false
    // }
    // catch (e) { /* no template found */ }

    if (needsTemplateFetch) {
      await this.minio.fGetObject(config.assets.packagesBucket, 'template.zip', path.join(os.tmpdir(), 'template.zip'))
    }

    const templateEntries = await extractTemplate(path.join(os.tmpdir(), 'template.zip'), outDir)

    const
      archivePath = `${outDir}.zip`,
      archive = new yazl.ZipFile()
    await processTemplate(outDir, rootUuid, templateEntries, mapResults, archive)
    await storeData(outDir, rootUuid, mapResults, archive, requestConfig)
    archive.end()

    await new Promise((resolve, reject) => {
      archive.outputStream.pipe(fs.createWriteStream(archivePath))
        .on('error', err => reject(err))
        .on('close', () => resolve())
    })

    await this.minio.fPutObject(config.assets.packagesBucket, `${rootUuid}.zip`, archivePath, { 'Content-Type': 'application/zip' })
    await fs.unlink(archivePath)
    await fsx.remove(outDir)

    const url = await this.minio.presignedGetObject(config.assets.packagesBucket, `${rootUuid}.zip`)
    send(res, 200, url)
  }
}

module.exports = Packager
