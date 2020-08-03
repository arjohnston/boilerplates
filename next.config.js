const withCSS = require('@zeit/next-css')
const withPWA = require('next-pwa')

module.exports = withPWA(
  withCSS({
    pwa: {
      dest: 'public'
    }
  })
)
