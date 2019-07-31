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
  if (results.maps.filter(map => map.uuid === uuid).length) return results
  const linkedGrids = []

  let mapResult
  try {
    mapResult = await axios.get(`${config.api.apiHost}/maps/${uuid}`, requestConfig)
  }
  catch (e) {
    console.log('Failed to get map for UUID', uuid)
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

  if (map.type.indexOf(constants.mapTypes.MAP_TYPE_2DGRID) === -1) {
    return send(res, 400, 'Map type not supported')
  }

  const
    metaQuery = { 'body.type': '2DGridMetadata', 'target.id': map.id },
    metaResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(metaQuery)}`, requestConfig)
  results.annotations.gridMetadata = results.annotations.gridMetadata.concat(metaResult.data.items)

  const
    cellQuery = { 'body.type': '2DCell', 'target.id': map.id },
    cellResult = await axios.get(`${config.api.apiHost}/annotations?query=${makeQuery(cellQuery)}`, requestConfig)
  results.annotations.cells = results.annotations.cells.concat(cellResult.data.items)

  for (let cell of cellResult.data.items) {
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
        if (gridUuid && gridUuid.length > 1 && gridUuid[1] !== uuid) {
          linkedGrids.push(gridUuid[1])
        }
      }
      if (type && type.toLowerCase() === 'image') {
        try {
          const basename = path.basename(new URL(content).pathname)
          if (results.files.indexOf(content) === -1) results.files.push(content)
          parsedValue.content = `statics/resources/files/${basename}`
          cell.body.value = JSON.stringify(parsedValue)
        }
        catch (e) {
          console.log('Failed to add image for URL', content)
        }
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

  for (let linkedUuid of linkedGrids) {
    const existing = results.maps.find(map => map.uuid === linkedUuid)
    if (!existing) {
      results = await fetchMap(linkedUuid, results, requestConfig)
    }
  }

  return results
}

module.exports = fetchMap
