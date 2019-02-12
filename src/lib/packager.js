const
  { ObjectUtil } = require('mbjs-utils'),
  axios = require('axios'),
  config = require('config'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri'),
  constants = require('mbjs-data-models/src/constants'),
  os = require('os'),
  fs = require('mz/fs'),
  path = require('path'),
  fsx = require('fs-extra'),
  yazl = require('yazl'),
  readArchive = require('../lib/read-archive'),
  send = require('@polka/send-type'),
  { DateTime } = require('luxon'),
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
    const makeQuery = query => encodeURIComponent(JSON.stringify(query))
    const
      metadata = {},
      maps = [],
      annotations = {
        gridMetadata: [],
        cells: [],
        data: []
      },
      requestConfig = {
        headers: {
          Authorization: req.headers.authorization
        }
      },
      mapResult = await axios.get(`${config.api.apiHost}/maps/${parseURI(req.body.id).uuid}`, requestConfig)
    const rootMap = mapResult.data
    maps.push(rootMap)

    if (rootMap.type.indexOf(constants.mapTypes.MAP_TYPE_2DGRID) === -1) {
      return send(res, 400, 'Map type not supported')
    }

    const hasAnnotation = (uuid, annotations) => annotations.filter(a => a.uuid === uuid).length

    const optionalFetch = async url => {
      try {
        const result = await axios.get(url, requestConfig)
        return result.data
      } catch (e) {
        console.log('Optional fetch failed', url, e.message)
      }
    }

    const
      metaQuery = { 'body.type': '2DGridMetadata', 'target.id': rootMap.id },
      metaResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(metaQuery)}`, requestConfig)
    annotations.gridMetadata = metaResult.data.items

    const
      cellQuery = { 'body.type': '2DCell', 'target.id': rootMap.id },
      cellResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(cellQuery)}`, requestConfig)
    annotations.cells = cellResult.data.items

    for (let cell of annotations.cells) {
      let parsedValue
      try {
        parsedValue = JSON.parse(cell.body.value)
      } catch (e) { /* ignored */ }
      if (parsedValue) {
        const { sourceUuid } = parsedValue
        if (sourceUuid) {
          const data = await optionalFetch(`${config.api.apiHost}/annotations/${sourceUuid}`)
          if (data && !hasAnnotation(data.uuid, annotations.data)) annotations.data.push(data)
        }
      }
    }

    for (let annotation of annotations.data) {
      if (annotation.body.type === 'Video') {
        const metaResult = await optionalFetch(`${config.api.transcoderHost}/metadata/url?url=${encodeURIComponent(annotation.body.source.id)}`)
        metadata[annotation.uuid] = { annotation, metadata: metaResult || {} }

        const query = {
          'target.id': annotation.target.id,
          'target.selector.value': {
            $gte: annotation.target.selector.value
          }
        }
        if (metadata[annotation.uuid].duration) {
          query['$lt'] = DateTime.fromISO(annotation.target.selector.value, { setZone: true })
            .plus(metaResult.data.duration * 1000).toISO()
        }
        const data = await optionalFetch(`${config.api.apiHost}/annotations?query=${makeQuery(query)}`)
        if (data && data.items) {
          for (let item of data.items) {
            if (!hasAnnotation(item.uuid, annotations.data)) annotations.data.push(item)
          }
        }
      }
    }

    const archive = new yazl.ZipFile()

    const outDir = path.join(os.tmpdir(), ObjectUtil.uuid4())
    await fsx.ensureDir(outDir)

    await this.minio.fGetObject(config.assets.packagesBucket, 'template.zip', path.join(os.tmpdir(), 'template.zip'))
    const results = await readArchive(path.join(os.tmpdir(), 'template.zip'), outDir)

    for (let result of results) {
      archive.addFile(path.join(outDir, result), path.join(rootMap.uuid, result))
    }

    const dataDir = path.join('statics', 'resources')
    await fsx.ensureDir(path.join(outDir, dataDir))

    const
      rootfile = path.join(dataDir, 'root.json'),
      rootout = path.join(outDir, rootfile)
    await fs.writeFile(rootout, JSON.stringify({ uuid: rootMap.uuid }))
    archive.addFile(rootout, path.join(rootMap.uuid, rootfile))

    const
      mapfile = path.join(dataDir, 'maps.json'),
      mapout = path.join(outDir, mapfile)
    await fs.writeFile(mapout, JSON.stringify(maps))
    archive.addFile(mapout, path.join(rootMap.uuid, mapfile))

    const
      allAnnotations = [].concat(annotations.data).concat(annotations.cells).concat(annotations.gridMetadata),
      annofile = path.join(dataDir, 'annotations.json'),
      annoout = path.join(outDir, annofile)
    await fs.writeFile(annoout, JSON.stringify(allAnnotations))
    archive.addFile(annoout, path.join(rootMap.uuid, annofile))

    const
      metaobjects = [],
      metafile = path.join(dataDir, 'metadata.json'),
      metaout = path.join(outDir, metafile)
    Object.keys(metadata).forEach(key => metaobjects.push(metadata[key]))
    await fs.writeFile(metaout, JSON.stringify(metaobjects))
    archive.addFile(metaout, path.join(rootMap.uuid, metafile))

    archive.end()

    const archivePath = `${outDir}.zip`
    await new Promise((resolve, reject) => {
      archive.outputStream.pipe(fs.createWriteStream(archivePath))
        .on('error', err => {
          reject(err)
        })
        .on('close', () => {
          resolve()
        })
    })

    await this.minio.fPutObject(config.assets.packagesBucket, `${rootMap.uuid}.zip`, archivePath, { 'Content-Type': 'application/zip' })
    await fs.unlink(archivePath)
    await fsx.remove(outDir)

    const url = await this.minio.presignedGetObject(config.assets.packagesBucket, `${rootMap.uuid}.zip`)
    send(res, 200, url)
  }
}

module.exports = Packager
