import { phoneStatus } from './phone.mjs'
import { hostNetwork } from './host.mjs'

export async function connectionStatus(adb) {
  const [phone, host] = await Promise.all([phoneStatus(adb), hostNetwork()])
  return {
    ok: true,
    ready: Boolean(phone.connected && phone.usbTethering && host.internet),
    phone,
    host,
  }
}
