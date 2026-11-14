export function parseMobileIp(output) {
  let currentInterface = ''

  for (const line of String(output || '').split('\n')) {
    const interfaceMatch = line.match(/^\d+:\s+([^:@\s]+)[:@]/)
    if (interfaceMatch) {
      currentInterface = interfaceMatch[1]
      continue
    }
    if (!/(rmnet|ccmni|wwan)/i.test(currentInterface)) continue
    const match = line.match(/\binet (\d+\.\d+\.\d+\.\d+)/)
    if (match && !match[1].startsWith('127.')) return match[1]
  }

  return null
}

export async function phoneStatus(adb) {
  const status = {
    connected: false,
    deviceSerial: null,
    deviceStatus: 'not_connected',
    deviceModel: null,
    airplaneMode: null,
    usbTethering: null,
    usbState: null,
    mobileData: null,
    dataConnected: null,
    mobileIp: null,
    error: null,
  }

  let devices = []
  try {
    devices = await adb.devices()
  } catch (error) {
    status.deviceStatus = 'adb_missing'
    status.error = error.message
    return status
  }

  let target = null
  if (adb.serial) {
    target = devices.find((device) => device.serial === adb.serial) || null
  } else if (devices.length === 1) {
    target = devices[0]
  } else if (devices.length > 1) {
    status.deviceStatus = 'multiple'
    status.error = 'Multiple Android devices connected; select a serial first.'
    return status
  }

  if (!target) {
    status.deviceStatus = 'not_connected'
    status.error = adb.serial
      ? `No device with serial "${adb.serial}" is connected.`
      : 'No Android device connected.'
    return status
  }

  status.deviceSerial = target.serial
  status.deviceStatus = target.state
  status.deviceModel = target.model || null

  if (target.state !== 'device') {
    if (target.state === 'unauthorized') {
      status.error = 'Device is connected but not authorized. Accept the USB debugging prompt.'
    }
    return status
  }

  status.connected = true

  const safe = async (...args) => {
    try {
      return await adb.shell(...args)
    } catch {
      return null
    }
  }

  const [airplane, usbState, mobileData, registry, ipOutput] = await Promise.all([
    safe('settings', 'get', 'global', 'airplane_mode_on'),
    safe('getprop', 'sys.usb.state'),
    safe('settings', 'get', 'global', 'mobile_data'),
    safe('dumpsys', 'telephony.registry'),
    safe('ip', '-f', 'inet', 'addr'),
  ])

  if (airplane === '1') status.airplaneMode = true
  else if (airplane === '0') status.airplaneMode = false

  status.usbState = usbState || null
  status.usbTethering = usbState ? /rndis/i.test(usbState) : null

  if (mobileData === '1') status.mobileData = true
  else if (mobileData === '0') status.mobileData = false

  const dataState = String(registry || '').match(/mDataConnectionState=(\d+)/)
  status.dataConnected = dataState ? dataState[1] === '2' : null
  status.mobileIp = parseMobileIp(ipOutput)

  return status
}
