const nodemailer = require('nodemailer')
const fs = require('fs')
const readline = require('readline')
const { google } = require('googleapis')

// Configuration files
const config = require('./config/config')

const SCOPES = ['https://mail.google.com/']
const TOKEN_PATH = './config/token.json'

const {
  CLIENT_SECRET,
  CLIENT_ID,
  REDIRECT_URIS,
  USER,
  RECIPIENT
} = config.google.contact_form

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID, CLIENT_SECRET, REDIRECT_URIS[0])

// Check if we have previously stored a token.
fs.readFile(TOKEN_PATH, (err, token) => {
  if (err) return getNewToken(oAuth2Client)

  // if (checkIfTokenIsExpired(JSON.parse(token))) refreshAccessToken()

  oAuth2Client.setCredentials(JSON.parse(token))
})

function getNewToken (oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    // Uncomment the following to get a refresh token
    // prompt: 'consent',
    scope: SCOPES
  })
  console.log('Authorize this app by visiting this url:', authUrl)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.question('Enter the code from that page here: ', (code) => {
    rl.close()

    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err)
      oAuth2Client.setCredentials(token)
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err)
        console.log('Token stored to', TOKEN_PATH)
      })
    })
  })
}

function checkIfTokenIsExpired (token) {
  return Date.now() >= token.expiry_date
}

const send = ({ email, name, message, phone, contactType }) => {
  const from = name && email ? `${name} <${email}>` : `${name || email}`
  const mail = {
    from: USER,
    to: RECIPIENT,
    subject: `New message from ${from}`,
    generateTextFromHTML: true,
    html: `
      A new message been generated from the Contact Form at <a href='https://essentialhydration.net/contact'>https://essentialhydration.net/contact</a><br /><br />
      Name: ${name}<br />
      Email: ${email}<br />
      ${phone !== '' ? `Phone: ${phone}<br />Preferred Contact Method: ${contactType}<br />` : ''}
      Message: ${message}
    `
  }

  return new Promise((resolve, reject) => {
    function callback (token) {
      const smtpTransport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: USER,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          accessToken: token.access_token
        }
      })

      if (process.env.NODE_ENV === 'production') {
        smtpTransport.sendMail(mail, (error, response) => {
          error ? reject(error) : resolve(response)
          smtpTransport.close()
        })
      } else {
        console.log('DEV - Mail:')
        console.log(mail)
        resolve()
      }
    }

    function refreshAccessToken () {
      oAuth2Client.setCredentials({
        refresh_token: config.google.contact_form.REFRESH_TOKEN
      })

      oAuth2Client.getAccessToken().then(token => {
        fs.writeFile(TOKEN_PATH, JSON.stringify(token.res.data), (err) => {
          if (err) return console.error(err)
          console.log('Token stored to', TOKEN_PATH)
          callback(token.res.data)
        })
      })
    }

    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) console.log(err)

      // This needs a .then or async statement so it doesnt move until a new access token is created
      if (checkIfTokenIsExpired(JSON.parse(token))) refreshAccessToken()
      else callback(JSON.parse(token))
    })
  })
}

module.exports = {
  send
}
