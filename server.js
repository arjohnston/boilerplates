/* jshint esversion: 6 */
/* global fetch:false */

const express = require('express')
const compression = require('compression')
const next = require('next')
const LRUCache = require('lru-cache')
const bodyParser = require('body-parser')
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dir: '.', dev })
const handle = app.getRequestHandler()
const address = require('address')
const mailer = require('./mailer')
const helmet = require('helmet')
const expressSanitizer = require('express-sanitizer')

require('es6-promise').polyfill()
require('isomorphic-fetch')

// Configuration files
const config = require('./config/config')

// This is where we cache our rendered HTML pages
const cacheTime = dev ? 100 : 1000 * 60 * 60 // 1 hour
const ssrCache = new LRUCache({
  max: 100,
  maxAge: cacheTime
})

app.prepare().then(() => {
  const server = express()
  server.use(compression())
  server.use(bodyParser.json())
  server.use(expressSanitizer())
  server.use(
    helmet.frameguard({
      action: 'allow-from',
      domain: 'http://kschricker.emergencyuniversity.com'
    })
  )

  if (!dev) {
    const sixtyDaysInSeconds = 5184000
    server.use(
      helmet.hsts({
        maxAge: sixtyDaysInSeconds
      })
    )

    server.use(
      helmet.contentSecurityPolicy({
        directives: {
          scriptSrc: [
            "'self'",
            'www.google-analytics.com',
            'www.google.com',
            'www.gstatic.com',
            'data:'
          ]
        }
      })
    )
    server.use(
      helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' })
    )

    server.use(
      helmet.featurePolicy({
        features: {
          fullscreen: ["'self'"],
          geolocation: ["'self'"]
        }
      })
    )

    server.use(helmet.noSniff())

    server.disable('x-powered-by')
  }

  // Method to cache pages on load
  // Populate all pages to be stored in cache
  server.get('/', (req, res) => {
    renderAndCache(req, res, '/')
  })

  // Serve static files at root
  // const options = {
  //   root: path.join(__dirname, '/static/'),
  //   headers: {
  //     'Content-Type': 'text/plain;charset=UTF-8'
  //   }
  // }
  // server.get('/robots.txt', (req, res) =>
  //   res.status(200).sendFile('robots.txt', options)
  // )
  // server.get('/favicon.ico', (req, res) =>
  //   res.status(200).sendFile('favicon.ico', options)
  // )
  // server.get('/sitemap.xml', (req, res) =>
  //   res.status(200).sendFile('sitemap.xml', options)
  // )

  // Fetch POST data for form submissions
  server.post('/api/recaptcha', (req, res) => {
    // Don't submit the API on DEV
    if (dev) return { result: 'DEV', status: 200 }

    if (req.body.key) {
      const url =
        'https://www.google.com/recaptcha/api/siteverify?secret=' +
        config.google.recaptcha.SECRET_KEY +
        '&response=' +
        req.body.key

      fetch(url, {
        method: 'POST'
      })
        .then(response => {
          if (response.status >= 200 && response.status < 300) {
            return response.json()
          } else {
            const error = new Error(response.statusText)
            error.response = response
            throw error
          }
        })
        .then(data => {
          res.status(200).send({ result: data.success })
        })
        .catch(err => {
          console.log(err)
          res.sendStatus(err.response.status)
        })
    }
  })

  server.post('/api/contact', (req, res) => {
    const {
      email = '',
      name = '',
      message = '',
      phone = '',
      contactType = ''
    } = req.body

    mailer.send({ email, name, message, phone, contactType }).then(() => {
      res.sendStatus(200)
    }).catch((error) => {
      res.sendStatus(error.response.status)
    })
  })

  // Utilize the below for each redirect
  // server.get(url, function (req, res) {
  //   res.redirect(newUrl)
  // })

  // This strips away the trailing '/' in the route
  // eslint throwing an unnecessary error with the regex '\/'
  /* eslint-disable */
  server.get('\\S+/$', function(req, res) {
    return res.redirect(
      301,
      req.path.slice(0, -1) + req.url.slice(req.path.length)
    )
  })
  /* eslint-enable */

  // serve the remaining pages that are not caught by redirects
  // or renderAndCache
  server.get('*', (req, res) => {
    return handle(req, res)
  })

  if (dev) {
    server.listen(3000, err => {
      if (err) {
        console.log(err)
        throw err
      }
      console.log('You can view the app in the browser:')
      console.log()
      console.log('Local:               http://localhost:3000')
      console.log(`On Your Network:     http://${address.ip()}:3000`)
      console.log()
      console.log('Note that the development build is not optimized.')
      console.log('To create a production build, use npm run build')
    })
  } else {
    server.listen(8080, err => {
      if (err) throw err
      const CLEAR_CONSOLE = '\x1Bc'
      const GREEN_TEXT = '\x1b[32m'
      const BLACK_TEXT = '\x1b[30m'
      const RESET_TEXT = '\x1b[0m'
      const GREEN_BG = '\x1b[42m'
      const TEXT_TITLE = `${GREEN_BG}${BLACK_TEXT} DONE ${RESET_TEXT}`
      const TEXT_SUBTITLE = `${GREEN_TEXT}Compiled Successfully${RESET_TEXT}`

      process.stdout.write(CLEAR_CONSOLE)
      console.log(TEXT_TITLE + ' ' + TEXT_SUBTITLE)
      console.log()
      console.log('You can view the app in the browser:')
      console.log()
      console.log('Local:               http://localhost:8080')
      console.log(`On Your Network:     http://${address.ip()}:8080`)
    })
  }
})

/*
 * NB: make sure to modify this to take into account anything that should trigger
 */
function getCacheKey (req) {
  return `${req.url}`
}

function renderAndCache (req, res, pagePath, queryParams) {
  const key = getCacheKey(req)

  // If we have a page in the cache, let's serve it
  if (ssrCache.has(key)) {
    // Enable to track cache logging
    // console.log(`CACHE HIT: ${key}`)
    res.send(ssrCache.get(key))
    return
  }

  // If not let's render the page into HTML
  app
    .renderToHTML(req, res, pagePath, queryParams)
    .then(html => {
      // Let's cache this page
      // Enable to track cache logging
      // console.log(`CACHE MISS: ${key}`)
      ssrCache.set(key, html)

      res.send(html)
    })
    .catch(err => {
      app.renderError(err, req, res, pagePath, queryParams)
    })
}
