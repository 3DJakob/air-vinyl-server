const os = require('os')
const path = require('path')
const express = require('express')
const getJsonBody = require('@body/json')
const mdns = require('mdns')
const createValidator = require('is-my-json-valid')
const execa = require('execa')

const app = express()

function openInputStream () {
  if (os.platform() === 'darwin') {
    return execa('sox', ['--no-show-progress', '--default-device', '--encoding', 'signed-integer', '--channels', '2', '--bits', '16', '--endian', 'little', '--rate', '44100', '--type', 'raw', '-'], { stdio: ['ignore', 'pipe', 'inherit'] })
  } else {
    return execa('arecord', ['-t', 'raw', '-f', 'cd', '--device=hw:1,0'], { stdio: ['ignore', 'pipe', 'inherit'] })
  }
}

const validateConfiguration = createValidator({
  type: 'object',
  properties: {
    device: { type: ['string', 'null'], minLength: 1 }
  },
  required: [
    'device'
  ]
})

const devices = new Map()

let currentInput = null
let currentStreamer = null
let currentDevice = null

app.get('/api/devices', (req, res) => {
  res.json([...devices.values()].map(device => ({ ...device, playing: currentDevice === device.id })))
})

app.patch('/api/configuration', async (req, res) => {
  const body = await getJsonBody(req)
  // console.error(body)

  if (!validateConfiguration(body)) {
    res.status(400).json({ error: 'Invalid configuration', source: validateConfiguration.errors })
    return
  }

  if (currentInput != null) {
    await currentInput.cancel()
  }

  if (currentStreamer != null) {
    await currentStreamer.cancel()
  }

  if (currentDevice != null) {
    currentDevice = null
  }

  if (body.device != null) {
    const device = devices.get(body.device)

    currentInput = openInputStream()
    currentStreamer = execa('./raop_play', ['-d', '3', '-a', '-p', String(device.port), device.address, '-'], { stdio: [currentInput.stdout, 'ignore', 'inherit'], env: { RUST_BACKTRACE: '1' } })
    currentDevice = body.device
  }

  res.status(204).end()
})

app.use(express.static('/Users/jakob/coding/air-vinyl-ui/build/'))

app.listen(3000, function () {
  console.log('listening on *:3000')
})

const browser = mdns.createBrowser(mdns.tcp('airplay'))
browser.on('serviceUp', service => {
  const newDevice = {
    name: service.name,
    id: service.fullname,
    host: service.host,
    port: service.port,
    playing: false,
    address: service.addresses[1]
  }

  devices.set(service.fullname, newDevice)
})

browser.on('serviceDown', service => {
  console.log('service down: ', service)
  devices.delete(service.fullname)
})
browser.start()
