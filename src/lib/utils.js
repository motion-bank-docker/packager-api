const axios = require('axios')

const
  makeQuery = query => encodeURIComponent(JSON.stringify(query)),
  hasAnnotation = (id, annotations) => annotations.filter(a => a.id === id).length

const optionalFetch = async (url, requestConfig) => {
  try {
    const result = await axios.get(url, requestConfig)
    return result.data
  } catch (e) {
    console.log('Optional fetch failed', url, e.message)
  }
}

module.exports = {
  makeQuery,
  hasAnnotation,
  optionalFetch
}
