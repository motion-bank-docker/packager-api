const
  axios = require('axios'),
  config = require('config'),
  constants = require('mbjs-data-models/src/constants'),
  parseURI = require('mbjs-data-models/src/lib/parse-uri'),
  path = require('path'),
  {
    makeQuery,
    hasAnnotation,
    hasCell,
    optionalFetch
  } = require('./utils')

const fetchMap = async function (id, results, requestConfig) {
  if (results.maps.filter(map => map.id === id).length) return results
  const linkedGrids = []

  let mapResult
  try {
    console.log('--- Fetch map:', id)
    mapResult = await axios.get(`${config.api.apiHost}/maps/${parseURI(id).uuid}`, requestConfig)
  }
  catch (err) {
    console.error('Failed to get map for ID', id, err.message)
    return results
  }

  const map = mapResult.data
  if (map.stylesheet && map.stylesheet.id) {
    try {
      const basename = path.basename(new URL(map.stylesheet.id).pathname)
      results.files.push(map.stylesheet.id)
      map.stylesheet.id = `statics/resources/files/${basename}`
    }
    catch (err) {
      console.error('Failed to add grid stylesheet for URL', map.stylesheet.id, err.message)
    }
  }

  results.maps.push(map)

  if (!process.env.SKIP_MAP_CHECK && map.type.indexOf(constants.mapClasses.MAP_CLASS_GRID) === -1) {
    throw new TypeError('Map type not supported')
  }

  console.log('Fetch annotations for map:', map.id)
  const
    annotationsQuery = { 'target.id': map.id },
    annotationsResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(annotationsQuery)}`, requestConfig)

  results.annotations = results.annotations.concat(annotationsResult.data.items)

  async function fetchLinkedAnnotations (annotation) {
    // FIXME: Enable cell start and end config
    const
      startMillis = annotation.target.selector._valueMillis, // + (this.cell.source._value.start ? this.cell.source._value.start * 1000 : 0),
      endMillis = startMillis + annotation.target.selector._valueDuration // (this.cell.source._value.duration * 1000 || this.video.target.selector._valueDuration || 0)
    const annotationsQuery = {
      'target.id': annotation.target.id,
      'target.type': constants.mapTypes.MAP_TYPE_TIMELINE,
      'body.type': 'TextualBody',
      'target.selector._valueMillis': {
        $gte: startMillis,
        $lte: endMillis
      }
    }
    console.log('Fetch linked annotations for target id:', annotation.target.id)
    const annotationsResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(annotationsQuery)}`, requestConfig)
    for (const annotation of annotationsResult.data.items) {
      if (annotation && !hasAnnotation(annotation.id, results.annotations)) results.annotations.push(annotation)
    }
  }

  for (const annotation of results.annotations) {
    if (annotation.body.type === `${constants.BASE_URI_NS}cell.jsonld` && annotation.body.source.id) {
      console.log('Fetch cell for source id:', annotation.body.source.id)
      const cellResult = await axios.get(`${config.api.apiHost}/cells/${parseURI(annotation.body.source.id).uuid}`, requestConfig)
      if (cellResult.data && !hasCell(cellResult.data.id, results.cells)) {
        results.cells.push(cellResult.data)
      }
    }
    else if (annotation.body.type === 'Video') {
      console.log('Fetch video meta annotations for source id:', annotation.body.source.id)
      const
        metaQuery = { 'target.id': annotation.body.source.id },
        metaResults = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(metaQuery)}`, requestConfig)
      for (const annotation of metaResults.data.items) {
        if (annotation && !hasAnnotation(annotation.id, results.annotations)) results.annotations.push(annotation)
      }

      await fetchLinkedAnnotations(annotation)
    }
  }

  for (const cell of results.cells) {
    if (cell.source._value.link) {
      const
        getGridUuid = /^.*\/mosys\/grids\/([a-f0-9\-]+).*/,
        gridUuid = cell.source._value.link.match(getGridUuid)
      if (gridUuid && gridUuid.length > 1 && gridUuid[1] !== parseURI(id).uuid) {
        const linkedGridId = `${constants.BASE_URI}maps/${gridUuid[1]}`
        if (!linkedGrids.includes(linkedGridId)) linkedGrids.push(linkedGridId)
      }
    }
    if (cell.configuration._value.component === 'CellImage') {
      if (cell.source._value.content.indexOf('statics/resources/files/') !== 0) {
        const basename = path.basename(new URL(cell.source._value.content).pathname)
        if (!results.files.includes(cell.source._value.content)) results.files.push(cell.source._value.content)
        cell.source._value.content = `statics/resources/files/${basename}`
        cell.source.value = JSON.stringify(cell.source._value)
      }
    }
    else if (cell.source._value.id) {
      if (cell.source._value.id.indexOf(`${constants.BASE_URI}annotations/`) === 0) {
        const data = await optionalFetch(`${config.api.apiHost}/annotations/${parseURI(cell.source._value.id).uuid}`, requestConfig)
        if (data) {
          if (!hasAnnotation(data.id, results.annotations)) {
            results.annotations.push(data)
            await fetchLinkedAnnotations(data)
          }
        }
      }
    }
  }

  for (let linkedId of linkedGrids) {
    const existing = results.maps.find(map => map.id === linkedId)
    if (!existing) {
      console.log('--- fetchMap: linked map', map.id)
      results = await fetchMap(linkedId, results, requestConfig)
    }
  }

  return results
}

module.exports = fetchMap
