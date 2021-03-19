const
  axios = require('axios'),
  fs = require('mz/fs'),
  path = require('path'),
  fsx = require('fs-extra'),
  config = require('config'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri')

const fetchFiles = async function (outDir, rootId, files, archive, requestConfig) {
  const
    rootUuid = parseURI(rootId).uuid,
    filesDir = path.join('statics', 'resources', 'files')
  await fsx.ensureDir(path.join(outDir, filesDir))

  for (let file of files) {
    try {
      const
        basename = path.basename(new URL(file).pathname),
        output = fs.createWriteStream(path.join(outDir, filesDir, basename))
      let requestParams = {
        url: file,
        method: 'GET',
        responseType: 'stream'
      }
      if (config.api.apiHost && file.indexOf(config.api.apiHost) === 0) {
        requestParams = Object.assign(requestParams, requestConfig)
      }
      const result = await axios(requestParams)
      result.data.pipe(output)
      await new Promise((resolve, reject) => {
        output.on('error', err => reject(err))
        output.on('finish', () => resolve())
      })
      archive.addFile(path.join(outDir, filesDir, basename), path.join(rootUuid, filesDir, basename))
    }
    catch (e) {
      console.log('File fetch failed', file, e.message)
    }
  }
}

module.exports = fetchFiles
