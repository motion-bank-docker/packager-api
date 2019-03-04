const
  fs = require('mz/fs'),
  path = require('path'),
  { JSDOM } = require('jsdom')

const processTemplate = async function (outDir, rootUuid, entries, mapResults, archive) {
  for (let entry of entries) {
    if (entry.indexOf('index.html') > -1) {
      const
        html = await fs.readFile(path.join(outDir, entry)),
        dom = new JSDOM(html)
      dom.window.document.title = mapResults.maps.length ? mapResults.maps[0].title : 'MoSys Grid'
      dom.window.document.querySelector("meta[name=description]")
        .setAttribute('content', 'Published using MoSys by Motion Bank')
      await fs.writeFile(path.join(outDir, entry), dom.serialize())
    }
    archive.addFile(path.join(outDir, entry), path.join(rootUuid, entry))
  }
}

module.exports = processTemplate
