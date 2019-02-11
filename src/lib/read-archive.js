const
  path = require('path'),
  yauzl = require('yauzl'),
  fs = require('mz/fs'),
  fsx = require('fs-extra')

const readArchive = (archivePath, outPath) => {
  const results = []
  const extractFile = (entry, filePath, zipfile) => {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath)
      writeStream.on('error', err => reject(err))
      writeStream.on('close', () => resolve())
      zipfile.openReadStream(entry, function (err, readStream) {
        if (err) return reject(err)
        readStream.pipe(writeStream)
      })
    })
  }
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, {lazyEntries: true}, async (err, zipfile) => {
      if (err) return reject(err)
      zipfile.readEntry()
      zipfile.on('end', () => resolve(results))
      zipfile.on('error', err => reject(err))
      zipfile.on('entry', async entry => {
        if (/\/$/.test(entry.fileName)) zipfile.readEntry()
        else {
          const prefix = path.basename(archivePath, '.zip')
          const filePath = path.dirname(entry.fileName).substr(prefix.length + 1)
          await fsx.ensureDir(path.join(outPath, filePath))
          await extractFile(entry, path.join(outPath, filePath, path.basename(entry.fileName)), zipfile)
          results.push(path.join(filePath, path.basename(entry.fileName)))
          zipfile.readEntry()
        }
      })
    })
  })
}

module.exports = readArchive
