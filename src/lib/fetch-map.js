const
  axios = require('axios'),
  config = require('config'),
  constants = require('mbjs-data-models/src/constants'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri'),
  path = require('path'),
  send = require('@polka/send-type'),
  {
    makeQuery,
    hasAnnotation,
    optionalFetch
  } = require('./utils')

const fetchMap = async function (id, results, requestConfig) {
  if (results.maps.filter(map => map.id === id).length) return results
  const linkedGrids = []

  let mapResult
  try {
    mapResult = await axios.get(`${config.api.apiHost}/maps/${parseURI(id).uuid}`, requestConfig)
  }
  catch (e) {
    console.log('Failed to get map for ID', id)
    return results
  }

  const map = mapResult.data
  if (map.stylesheet && map.stylesheet.id) {
    try {
      const basename = path.basename(new URL(map.stylesheet.id).pathname)
      results.files.push(map.stylesheet.id)
      map.stylesheet.id = `statics/resources/files/${basename}`
    }
    catch (e) {
      console.log('Failed to add grid stylesheet for URL', map.stylesheet.id)
    }
  }

  results.maps.push(map)

  if (map.type.indexOf(constants.mapClasses.MAP_CLASS_GRID) === -1) {
    return send(res, 400, 'Map type not supported')
  }

  const
    annotationsQuery = { 'target.id': map.id },
    annotationsResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(annotationsQuery)}`, requestConfig)

  results.annotations = results.annotations.concat(annotationsResult.data.items)

  for (const annotation of results.annotations) {
    if (annotation.body.type === `${constants.BASE_URI_NS}cell.jsonld` && annotation.body.source.id) {
      const cellResult = await axios.get(`${config.api.apiHost}/cells/${parseURI(annotation.body.source.id).uuid}`, requestConfig)
      results.cells.push(cellResult.data)
    }
    else if (annotation.body.type === 'Video') {
      const
        metaQuery = { 'target.id': annotation.body.source.id },
        metaResults = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(metaQuery)}`, requestConfig)
      for (const annotation of metaResults.data.items) {
        if (annotation && !hasAnnotation(annotation.id, results.annotations)) results.annotations.push(annotation)
      }
    }
  }

  for (const cell of results.cells) {
    if (cell.source._value.link) {
      const
        getGridUuid = /^.*\/mosys\/grids\/([a-f0-9\-]+).*/,
        gridUuid = cell.source._value.link.match(getGridUuid)
      if (gridUuid && gridUuid.length > 1 && gridUuid[1] !== parseURI(id).uuid) {
        linkedGrids.push(`${constants.BASE_URI}maps/${gridUuid[1]}`)
      }
    }
    if (cell.configuration._value.component === 'CellImage') {
      if (cell.source._value.content.indexOf('statics/resources/files/') !== 0) {
        const basename = path.basename(new URL(cell.source._value.content).pathname)
        if (results.files.indexOf(cell.source._value.content) === -1) results.files.push(cell.source._value.content)
        cell.source._value.content = `statics/resources/files/${basename}`
        cell.source.value = JSON.stringify(cell.source._value)
      }
    }
    else if (cell.source._value.id) {
      if (cell.source._value.id.indexOf(`${constants.BASE_URI}annotations/`) === 0) {
        const data = await optionalFetch(`${config.api.apiHost}/annotations/${parseURI(cell.source._value.id).uuid}`, requestConfig)
        if (data && !hasAnnotation(data.id, results.annotations)) results.annotations.push(data)
      }
    }
  }

  for (let linkedId of linkedGrids) {
    const existing = results.maps.find(map => map.id === linkedId)
    if (!existing) {
      results = await fetchMap(linkedId, results, requestConfig)
    }
  }

  return results
}

module.exports = fetchMap
