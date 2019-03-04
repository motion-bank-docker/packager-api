const
  fs = require('mz/fs'),
  path = require('path'),
  fsx = require('fs-extra'),
  fetchFiles = require('./fetch-files')

const storeData = async function (outDir, rootUuid, mapResults, archive, requestConfig) {
  const dataDir = path.join('statics', 'resources')
  await fsx.ensureDir(path.join(outDir, dataDir))

  await fetchFiles(outDir, rootUuid, mapResults.files, archive, requestConfig)

  const
    rootfile = path.join(dataDir, 'root.json'),
    rootout = path.join(outDir, rootfile)
  await fs.writeFile(rootout, JSON.stringify({ uuid: rootUuid }))
  archive.addFile(rootout, path.join(rootUuid, rootfile))

  const
    mapfile = path.join(dataDir, 'maps.json'),
    mapout = path.join(outDir, mapfile)
  await fs.writeFile(mapout, JSON.stringify(mapResults.maps))
  archive.addFile(mapout, path.join(rootUuid, mapfile))

  const
    allAnnotations = [].concat(mapResults.annotations.data)
      .concat(mapResults.annotations.cells)
      .concat(mapResults.annotations.gridMetadata),
    annofile = path.join(dataDir, 'annotations.json'),
    annoout = path.join(outDir, annofile)
  await fs.writeFile(annoout, JSON.stringify(allAnnotations))
  archive.addFile(annoout, path.join(rootUuid, annofile))

  const
    metaobjects = [],
    metafile = path.join(dataDir, 'metadata.json'),
    metaout = path.join(outDir, metafile)
  Object.keys(mapResults.metadata).forEach(key => metaobjects.push(mapResults.metadata[key]))
  await fs.writeFile(metaout, JSON.stringify(metaobjects))
  archive.addFile(metaout, path.join(rootUuid, metafile))
}

module.exports = storeData
