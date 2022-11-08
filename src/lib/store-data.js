const
  fs = require('mz/fs'),
  path = require('path'),
  fsx = require('fs-extra'),
  fetchFiles = require('./fetch-files'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri')

const storeData = async function (outDir, rootId, mapResults, archive, requestConfig) {
  const
    rootUuid = parseURI(rootId).uuid,
    dataDir = path.join('statics', 'resources')

  await fsx.ensureDir(path.join(outDir, dataDir))
  console.log('storeData: fetchFiles')
  await fetchFiles(outDir, rootId, mapResults.files, archive, requestConfig)

  const
    rootfile = path.join(dataDir, 'root.json'),
    rootout = path.join(outDir, rootfile)
  console.log('storeData: root.json')
  await fs.writeFile(rootout, JSON.stringify({ id: rootId, uuid: rootUuid }))
  archive.addFile(rootout, path.join(rootUuid, rootfile))

  const
    mapfile = path.join(dataDir, 'maps.json'),
    mapout = path.join(outDir, mapfile)
  console.log('storeData: maps.json')
  await fs.writeFile(mapout, JSON.stringify(mapResults.maps))
  archive.addFile(mapout, path.join(rootUuid, mapfile))

  const
    annofile = path.join(dataDir, 'annotations.json'),
    annoout = path.join(outDir, annofile)
  console.log('storeData: annotations.json')
  await fs.writeFile(annoout, JSON.stringify(mapResults.annotations))
  archive.addFile(annoout, path.join(rootUuid, annofile))

  const
    cellsFile = path.join(dataDir, 'cells.json'),
    cellsout = path.join(outDir, cellsFile)
  console.log('storeData: cells.json')
  await fs.writeFile(cellsout, JSON.stringify(mapResults.cells))
  archive.addFile(cellsout, path.join(rootUuid, cellsFile))
}

module.exports = storeData
