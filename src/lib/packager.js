const
  { ObjectUtil } = require('mbjs-utils'),
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

    api.app.post('/assets/:bucket', (req, res) => _this.postHandler(req, res))
    api.app.get('/assets/:bucket/*', (req, res) => _this.getHandler(req, res))
    api.app.get('/assets/:bucket', (req, res) => _this.getHandler(req, res))
    api.app.delete('/assets/:bucket/*', (req, res) => _this.deleteHandler(req, res))
  }

  async getHandler (req, res) {
    /** Extract object path */
    const
      parts = req.path.split('/'),
      object = parts.length >= 4 ? parts.splice(3).join('/') : undefined

    /** Check access permissions */
    let allowed = req.user && req.params.bucket === `user-${req.user.uuid}`
    if (!allowed) {
      try {
        allowed = await this._acl.areAnyRolesAllowed(
          ['public'].concat(req.user ? req.user.roles || [] : []),
          ObjectUtil.uuid5(`${req.params.bucket}${object ? '/' + object : ''}`),
          ['get'])
      }
      catch (err) {
        this._captureException(err)
      }
    }
    if (!allowed) return this._errorResponse(res, 403)

    /** Try to get metadata */
    let metadata
    try {
      metadata = await this.minio.statObject(req.params.bucket, object)
    }
    catch (err) {
      /** If object not found, assume it is a directory */
      if (!object || err.code === 'NotFound') {
        const
          _this = this,
          stream = this.minio.listObjects(req.params.bucket, object)

        let entries = []
        stream.on('error', err => {
          /** If list not found, return 404 */
          if (err.code === 'NotFound' || err.code === 'NoSuchBucket') _this._errorResponse(res, 404)
          else _this._captureException(err)
        })
        stream.on('data', data => {
          entries.push(data)
        })
        stream.on('end', () => {
          /** Return directory listing */
          _this._response(req, res, entries)
        })
      }
    }

    /** If metdata is found, set content-type and return object */
    if (metadata) {
      const stream = await this.minio.getObject(req.params.bucket, object)

      if (req.query.dl) res.setHeader('Content-Type', 'application/force-download')
      else  {
        res.setHeader('Content-Length', metadata.size)
        res.setHeader('Last-Modified', metadata.lastModified)
        res.setHeader('Content-Type', metadata.metaData ? metadata.metaData['content-type'] : 'application/octet-stream')
      }

      stream.pipe(res)
    }
  }

  async postHandler (req, res) {
    const
      _this = this,
      os = require('os'),
      path = require('path'),
      { ObjectUtil } = require('mbjs-utils'),
      multer = require('multer'),
      upload = multer({ dest: os.tmpdir() })

    upload.single('file')(req, res, async () => {
      /** Only allow if user bucket and owner */
      if (req.params.bucket !== `user-${req.user.uuid}`) return this._errorResponse(res, 403)

      /** Check if bucket exists */
      const exists = await _this.minio.bucketExists(req.params.bucket)

      /** If no bucket exists, create one */
      if (!exists) {
        try {
          await _this.minio.makeBucket(req.params.bucket)
        }
        catch (err) {
          _this._captureException(err)
          return _this._errorResponse(res, 500)
        }
      }

      const
        extname = path.extname(req.file.originalname),
        slug = ObjectUtil.slug(path.basename(req.file.originalname, extname))

      let filename = `${slug}${extname.toLowerCase()}`

      /** Put object */
      await _this.minio.fPutObject(
        req.params.bucket,
        filename,
        req.file.path,
        {
          'Content-Type': req.file.mimetype
        })

      let
        port = this.config.assets.client.port ? parseInt(this.config.assets.client.port) : undefined,
        secure = this.config.assets.client.secure &&
          (this.config.assets.client.secure === true ||
          this.config.assets.client.secure === 'true'),
        assetHost = `${secure ? 'https://' : 'http://'}${this.config.assets.client.endPoint}`

      if (port !== 80 && port !== 443) assetHost += `:${port}`
      assetHost += this.config.assets.host || assetHost
      assetHost += `/${req.params.bucket}`

      /** Return file info */
      this._response(req, res, {
        file: `${assetHost}/${filename}`,
        originalName: req.file.originalname
      })
    })
  }

  async deleteHandler (req, res) {
    /** Only allow if user bucket and owner */
    if (req.params.bucket !== `user-${req.user.uuid}`) return this._errorResponse(res, 403)

    const object = req.path.split('/').splice(3).join('/')

    /** Remove object */
    await this.minio.removeObject(req.params.bucket, object)
    this._response(req, res)
  }
}

module.exports = Packager
