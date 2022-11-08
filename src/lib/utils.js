const axios = require('axios')

const
  makeQuery = query => encodeURIComponent(JSON.stringify(query)),
  hasAnnotation = (id, annotations) => annotations.filter(a => a.id === id).length,
  hasCell = (id, cells) => cells.filter(c => c.id === id).length

const optionalFetch = async (url, requestConfig) => {
  try {
    console.log('optionalFetch', url)
    const result = await axios.get(url, requestConfig)
    return result.data
  } catch (e) {
    console.log('Optional fetch failed', url, e.message)
  }
}

module.exports = {
  makeQuery,
  hasAnnotation,
  hasCell,
  optionalFetch
}
