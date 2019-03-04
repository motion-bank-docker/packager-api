const
  axios = require('axios'),
  config = require('config'),
  constants = require('mbjs-data-models/src/constants'),
  path = require('path'),
  send = require('@polka/send-type'),
  { DateTime } = require('luxon'),
  {
    makeQuery,
    hasAnnotation,
    optionalFetch
  } = require('./utils')

const fetchMap = async function (uuid, results, requestConfig) {
  let mapResult = await axios.get(`${config.api.apiHost}/maps/${uuid}`, requestConfig)
  const rootMap = mapResult.data
  if (rootMap.stylesheet && rootMap.stylesheet.id) {
    results.files.push(rootMap.stylesheet.id)
    const basename = path.basename(new URL(rootMap.stylesheet.id).pathname)
    rootMap.stylesheet.id = `statics/resources/files/${basename}`
  }
  results.maps.push(rootMap)

  if (rootMap.type.indexOf(constants.mapTypes.MAP_TYPE_2DGRID) === -1) {
    return send(res, 400, 'Map type not supported')
  }

  const
    metaQuery = { 'body.type': '2DGridMetadata', 'target.id': rootMap.id },
    metaResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(metaQuery)}`, requestConfig)
  results.annotations.gridMetadata = metaResult.data.items

  const
    cellQuery = { 'body.type': '2DCell', 'target.id': rootMap.id },
    cellResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(cellQuery)}`, requestConfig)
  results.annotations.cells = cellResult.data.items

  for (let cell of results.annotations.cells) {
    let parsedValue
    try {
      parsedValue = JSON.parse(cell.body.value)
    } catch (e) { /* ignored */ }
    if (parsedValue) {
      const { sourceUuid, type, content, link } = parsedValue
      if (link) {
        const
          getGridUuid = /^.*\/mosys\/grids\/([a-f,0-9,-]+).*/,
          gridUuid = link.match(getGridUuid)
        if (gridUuid.length > 1 && gridUuid[1] !== uuid) {
          const results = await fetchMap(gridUuid[1], requestConfig)
          console.log('found linked grid', results)
        }
      }
      if (type && type.toLowerCase() === 'image') {
        if (results.files.indexOf(content) === -1) results.files.push(content)
        const basename = path.basename(new URL(content).pathname)
        parsedValue.content = `statics/resources/files/${basename}`
        cell.body.value = JSON.stringify(parsedValue)
      }
      else if (sourceUuid) {
        const data = await optionalFetch(`${config.api.apiHost}/annotations/${sourceUuid}`, requestConfig)
        if (data && !hasAnnotation(data.uuid, results.annotations.data)) results.annotations.data.push(data)
      }
    }
  }

  for (let annotation of results.annotations.data) {
    if (annotation.body.type === 'Video') {
      const
        metaUrl = `${config.api.transcoderHost}/metadata/url?url=${encodeURIComponent(annotation.body.source.id)}`,
        metaResult = await optionalFetch(metaUrl, requestConfig)
      results.metadata[annotation.uuid] = { annotation, metadata: metaResult || {} }

      const query = {
        'target.id': annotation.target.id,
        'target.selector.value': {
          $gte: annotation.target.selector.value
        }
      }
      if (results.metadata[annotation.uuid].duration) {
        query['$lt'] = DateTime.fromISO(annotation.target.selector.value, { setZone: true })
          .plus(metaResult.data.duration * 1000).toISO()
      }
      const data = await optionalFetch(`${config.api.apiHost}/annotations?query=${makeQuery(query)}`, requestConfig)
      if (data && data.items) {
        for (let item of data.items) {
          if (!hasAnnotation(item.uuid, results.annotations.data)) results.annotations.data.push(item)
        }
      }
    }
  }

  return results
}

module.exports = fetchMap
