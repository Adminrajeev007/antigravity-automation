#!/usr/bin/env node
import readline from 'node:readline'
import { loadConfig } from '../src/octo/config.mjs'
import { OctoClient } from '../src/octo/client.mjs'
import { ProfileService } from '../src/octo/profiles.mjs'
import { AndroidService } from '../src/android/service.mjs'
import { HidAutomation } from '../src/hid/hid.mjs'
import { fetchGoogleCode } from '../src/otp/dispose.mjs'
import {
  DEFAULT_EMAIL_DOMAIN,
  EMAIL_DOMAINS,
  EXTENSION_ACCOUNT_API_BASE,
  randomEmailDomain,
} from '../src/otp/domains.mjs'
import { RecordsService } from '../src/sheets/records.mjs'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'antig', version: '0.1.0' }

const config = loadConfig()
const client = new OctoClient()
const service = new ProfileService(client, config.octo)
const android = new AndroidService(config.android)
const hid = new HidAutomation()
const records = new RecordsService(config.sheets)

const PROFILE_ARG = { type: 'string', description: 'Profile name or 32-character UUID' }

const TOOLS = [
  {
    name: 'antig_status',
    description: 'Check whether the Octo Browser local API is reachable and return its port and account name.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_list_profiles',
    description: 'List Octo profiles with running state, proxy, and attached extensions.',
    inputSchema: {
      type: 'object',
      properties: {
        details: { type: 'boolean', description: 'Fetch extension details for each profile (default true)' },
      },
    },
  },
  {
    name: 'antig_get_profile',
    description: 'Get one profile by name or UUID, including its extensions, proxy, and launch arguments.',
    inputSchema: {
      type: 'object',
      properties: { profile: PROFILE_ARG },
      required: ['profile'],
    },
  },
  {
    name: 'antig_create_profile',
    description: 'Create a profile, attach one or more extensions before launch, optionally set a proxy, and optionally open it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Profile name' },
        extension: { type: 'string', description: 'Extension name, id, or compound id to attach' },
        extensions: { type: 'array', items: { type: 'string' }, description: 'Multiple extensions to attach' },
        os: { type: 'string', enum: ['mac', 'windows', 'linux'], description: 'Fingerprint operating system (default mac)' },
        osArch: { type: 'string', enum: ['x86', 'arm'], description: 'Fingerprint architecture (default x86)' },
        proxy: { type: 'string', description: 'direct or a proxy URL such as socks5://user:pass@host:1080' },
        launch: { type: 'boolean', description: 'Open the profile after creation' },
        launchArgs: { type: 'array', items: { type: 'string' }, description: 'Extra Chromium launch arguments' },
      },
      required: ['name'],
    },
  },
  {
    name: 'antig_delete_profile',
    description: 'Delete a profile. Running profiles are stopped first unless force is false.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        force: { type: 'boolean', description: 'Stop a running profile before deleting (default true)' },
      },
      required: ['profile'],
    },
  },
  {
    name: 'antig_launch_profile',
    description: 'Open a profile and return its CDP endpoint. Attached extensions load with the profile.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        debugPort: { type: 'boolean', description: 'Enable the CDP debug port (default true)' },
      },
      required: ['profile'],
    },
  },
  {
    name: 'antig_stop_profile',
    description: 'Stop a running profile.',
    inputSchema: {
      type: 'object',
      properties: { profile: PROFILE_ARG },
      required: ['profile'],
    },
  },
  {
    name: 'antig_list_extensions',
    description: 'List extensions installed in the Octo account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_attach_extension',
    description: 'Attach an extension to a stopped profile. It loads the next time the profile is launched.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        extension: { type: 'string', description: 'Extension name, id, or compound id' },
      },
      required: ['profile', 'extension'],
    },
  },
  {
    name: 'antig_detach_extension',
    description: 'Remove an extension from a stopped profile.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        extension: { type: 'string', description: 'Extension name, id, or compound id' },
      },
      required: ['profile', 'extension'],
    },
  },
  {
    name: 'antig_set_proxy',
    description: 'Set the proxy of a stopped profile. Use "direct" to clear it.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        proxy: { type: 'string', description: 'direct or a proxy URL such as socks5://user:pass@host:1080' },
      },
      required: ['profile', 'proxy'],
    },
  },
  {
    name: 'antig_rename_profile',
    description: 'Rename a stopped profile.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        name: { type: 'string', description: 'New profile name' },
      },
      required: ['profile', 'name'],
    },
  },
  {
    name: 'antig_set_launch_args',
    description: 'Replace the Chromium launch arguments of a stopped profile.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        args: { type: 'array', items: { type: 'string' }, description: 'Launch arguments' },
      },
      required: ['profile', 'args'],
    },
  },
  {
    name: 'antig_android_devices',
    description: 'List Android devices visible to adb.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_android_status',
    description: 'Read Android airplane mode, USB tethering, mobile data, data connection, and mobile IP over adb.',
    inputSchema: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
    },
  },
  {
    name: 'antig_connection_status',
    description: 'Report phone connectivity, host internet reachability, egress IP, and the default route.',
    inputSchema: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
    },
  },
  {
    name: 'antig_airplane_mode',
    description: 'Turn Android airplane mode on, off, or cycle it for a duration using adb UI automation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['on', 'off', 'cycle', 'status'], description: 'Operation to perform' },
        duration: { type: 'integer', minimum: 1, maximum: 300, description: 'Seconds for a cycle' },
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
      required: ['action'],
    },
  },
  {
    name: 'antig_usb_tether',
    description: 'Turn Android USB tethering on or off, or read its current state, using adb UI automation.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['on', 'off', 'status'], description: 'Operation to perform' },
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
      required: ['action'],
    },
  },
  {
    name: 'antig_network_reset',
    description: 'Cycle airplane mode for a duration, then enable USB tethering.',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'integer', minimum: 1, maximum: 300, description: 'Seconds for the airplane cycle' },
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
    },
  },
  {
    name: 'antig_hid_status',
    description: 'Check macOS Accessibility permission, the compiled HID helper, and display information.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_hid_request_permission',
    description: 'Open the macOS Accessibility permission prompt for the HID helper.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_hid_screens',
    description: 'List macOS screens with their frames and scale factors.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_hid_type',
    description: 'Type text into the currently focused macOS app using CoreGraphics HID events.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        intervalMs: { type: 'integer', minimum: 0, maximum: 1000, description: 'Delay between characters' },
        app: { type: 'string', description: 'Optional running app to activate first' },
      },
      required: ['text'],
    },
  },
  {
    name: 'antig_hid_key',
    description: 'Press a key with optional modifiers in the focused macOS app.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name such as return, tab, esc, up, or a letter' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'cmd, shift, alt, ctrl, fn, caps' },
        repeat: { type: 'integer', minimum: 1, maximum: 1000, description: 'Repeat count' },
        app: { type: 'string', description: 'Optional running app to activate first' },
      },
      required: ['key'],
    },
  },
  {
    name: 'antig_hid_combo',
    description: 'Send a key combo such as cmd+shift+t.',
    inputSchema: {
      type: 'object',
      properties: {
        combo: { type: 'string', description: 'Key combo, for example cmd+shift+t' },
        repeat: { type: 'integer', minimum: 1, maximum: 1000, description: 'Repeat count' },
        app: { type: 'string', description: 'Optional running app to activate first' },
      },
      required: ['combo'],
    },
  },
  {
    name: 'antig_hid_move',
    description: 'Move the macOS mouse cursor to global screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Global X coordinate' },
        y: { type: 'number', description: 'Global Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'antig_hid_click',
    description: 'Click the mouse at global screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Global X coordinate' },
        y: { type: 'number', description: 'Global Y coordinate' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
        count: { type: 'integer', minimum: 1, maximum: 3, description: 'Click count' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'antig_hid_scroll',
    description: 'Scroll the focused macOS app with pixel deltas.',
    inputSchema: {
      type: 'object',
      properties: {
        dx: { type: 'number', description: 'Horizontal pixels (positive is right)' },
        dy: { type: 'number', description: 'Vertical pixels (positive is up)' },
      },
    },
  },
  {
    name: 'antig_hid_drag',
    description: 'Drag the mouse between two global screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
        durationMs: { type: 'integer', minimum: 0, maximum: 60000 },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
  },
  {
    name: 'antig_hid_activate',
    description: 'Bring a running macOS app to the front by name or bundle id.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or bundle id, for example Octo Browser' },
      },
      required: ['app'],
    },
  },
  {
    name: 'antig_hid_wait',
    description: 'Wait for a number of milliseconds between HID actions.',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'integer', minimum: 0, maximum: 60000, description: 'Milliseconds to wait' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'antig_hid_sequence',
    description: 'Run a sequence of HID commands in order (activate, type, key, combo, click, move, scroll, drag, wait).',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of command objects with a command field',
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'antig_dispose_google_code',
    description: 'Fetch the newest Google verification code from dispose.lol for an email address.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address to check' },
        key: { type: 'string', description: 'Optional dispose.lol key override' },
      },
      required: ['email'],
    },
  },
  {
    name: 'antig_email_domains',
    description: 'List the email domains used by the GCP AG extension, or return one at random.',
    inputSchema: {
      type: 'object',
      properties: {
        random: { type: 'boolean', description: 'Return one random domain instead of the full list' },
      },
    },
  },
  {
    name: 'antig_rotate_profile',
    description: 'Cycle Android airplane mode and USB tethering to change IP, then delete the running profile and launch a replacement with the same extensions.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: PROFILE_ARG,
        extension: { type: 'string', description: 'Extension id used to find the running profile when profile is omitted' },
        name: { type: 'string', description: 'Optional name for the replacement profile' },
        resetNetwork: { type: 'boolean', description: 'Cycle airplane mode + tethering first (default true)' },
        duration: { type: 'integer', minimum: 1, maximum: 300, description: 'Airplane cycle seconds' },
        serial: { type: 'string', description: 'Optional adb device serial' },
      },
    },
  },
  {
    name: 'antig_records_status',
    description: 'Report whether the Google Sheets account/profile record store is configured.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'antig_records_list',
    description: 'Read account/profile records (email, token, status, and notes) from the Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, description: 'Maximum number of records to return' },
        status: { type: 'string', description: 'Only return records with this status' },
      },
    },
  },
  {
    name: 'antig_records_get',
    description: 'Read one account/profile record by id from the Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Record id' } },
      required: ['id'],
    },
  },
  {
    name: 'antig_records_create',
    description: 'Append a new account/profile record (email, token, status) to the Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional custom record id' },
        email: { type: 'string', description: 'Account email address' },
        token: { type: 'string', description: 'Access token or other secret' },
        status: { type: 'string', description: 'Record status such as new, active, or banned (default new)' },
        profileId: { type: 'string', description: 'Optional Octo profile UUID' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['email'],
    },
  },
  {
    name: 'antig_records_update',
    description: 'Update fields of an existing record in the Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Record id' },
        email: { type: 'string', description: 'Account email address' },
        token: { type: 'string', description: 'Access token or other secret' },
        status: { type: 'string', description: 'Record status' },
        profileId: { type: 'string', description: 'Octo profile UUID' },
        notes: { type: 'string', description: 'Notes' },
      },
      required: ['id'],
    },
  },
  {
    name: 'antig_records_upsert',
    description: 'Create or update a record. Matches by id, or by email when no id is given.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional record id' },
        email: { type: 'string', description: 'Account email address' },
        token: { type: 'string', description: 'Access token or other secret' },
        status: { type: 'string', description: 'Record status' },
        profileId: { type: 'string', description: 'Octo profile UUID' },
        notes: { type: 'string', description: 'Notes' },
      },
      required: ['email'],
    },
  },
  {
    name: 'antig_records_delete',
    description: 'Delete a record row from the Google Sheet.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Record id' } },
      required: ['id'],
    },
  },
]

async function callTool(name, args = {}) {
  switch (name) {
    case 'antig_status':
      return service.status()
    case 'antig_list_profiles':
      return service.list({ withDetails: args.details !== false })
    case 'antig_get_profile':
      return service.get(args.profile)
    case 'antig_create_profile':
      return service.create({
        name: args.name,
        extension: args.extension,
        extensions: args.extensions,
        os: args.os,
        osArch: args.osArch,
        proxy: args.proxy,
        launch: args.launch === true,
        launchArgs: args.launchArgs,
      })
    case 'antig_delete_profile':
      return service.remove(args.profile, { force: args.force !== false })
    case 'antig_launch_profile':
      return service.launch(args.profile, { debugPort: args.debugPort !== false })
    case 'antig_stop_profile':
      return service.stop(args.profile)
    case 'antig_list_extensions':
      return service.listExtensions()
    case 'antig_attach_extension':
      return service.attachExtension(args.profile, args.extension)
    case 'antig_detach_extension':
      return service.detachExtension(args.profile, args.extension)
    case 'antig_set_proxy':
      return service.setProxy(args.profile, args.proxy)
    case 'antig_rename_profile':
      return service.rename(args.profile, args.name)
    case 'antig_set_launch_args':
      return service.setLaunchArgs(args.profile, args.args)
    case 'antig_android_devices':
      try {
        return { ok: true, devices: await android.devices() }
      } catch (error) {
        return { ok: false, devices: [], error: error.message }
      }
    case 'antig_android_status':
      return android.withSerial(args.serial).status()
    case 'antig_connection_status':
      return android.withSerial(args.serial).connection()
    case 'antig_airplane_mode':
      return android.withSerial(args.serial).airplaneAction({
        action: args.action,
        duration: args.duration,
      })
    case 'antig_usb_tether':
      return android.withSerial(args.serial).tetherAction({ action: args.action })
    case 'antig_network_reset':
      return android.withSerial(args.serial).reset({ duration: args.duration })
    case 'antig_hid_status':
      return hid.status()
    case 'antig_hid_request_permission':
      return hid.requestPermission()
    case 'antig_hid_screens':
      return hid.screens()
    case 'antig_hid_type':
      if (args.app) await hid.activate(args.app)
      return hid.type(args.text, { intervalMs: args.intervalMs })
    case 'antig_hid_key':
      if (args.app) await hid.activate(args.app)
      return hid.key(args.key, { modifiers: args.modifiers, repeat: args.repeat })
    case 'antig_hid_combo':
      if (args.app) await hid.activate(args.app)
      return hid.combo(args.combo, { repeat: args.repeat })
    case 'antig_hid_move':
      return hid.move(args.x, args.y)
    case 'antig_hid_click':
      return hid.click(args.x, args.y, { button: args.button, count: args.count })
    case 'antig_hid_scroll':
      return hid.scroll(args.dx, args.dy)
    case 'antig_hid_drag':
      return hid.drag(args.fromX, args.fromY, args.toX, args.toY, {
        durationMs: args.durationMs,
        button: args.button,
      })
    case 'antig_hid_activate':
      return hid.activate(args.app)
    case 'antig_hid_wait':
      return hid.wait(args.ms)
    case 'antig_hid_sequence':
      return hid.sequence(args.steps)
    case 'antig_dispose_google_code':
      return fetchGoogleCode(args.email, { key: args.key })
    case 'antig_email_domains':
      if (args.random) return { ok: true, domain: randomEmailDomain() }
      return {
        ok: true,
        total: EMAIL_DOMAINS.length,
        defaultDomain: DEFAULT_EMAIL_DOMAIN,
        accountApiBase: EXTENSION_ACCOUNT_API_BASE,
        domains: EMAIL_DOMAINS,
      }
    case 'antig_rotate_profile': {
      let network = null
      if (args.resetNetwork !== false) {
        network = await android.withSerial(args.serial).reset({ duration: args.duration })
      }
      const rotated = await service.rotate({
        extension: args.extension,
        profile: args.profile,
        name: args.name,
      })
      return network ? { ...rotated, network } : rotated
    }
    case 'antig_records_status':
      return records.status()
    case 'antig_records_list':
      return records.list({ limit: args.limit, status: args.status })
    case 'antig_records_get':
      return records.get(args.id)
    case 'antig_records_create':
      return records.create({
        id: args.id,
        email: args.email,
        token: args.token,
        status: args.status,
        profileId: args.profileId,
        notes: args.notes,
      })
    case 'antig_records_update':
      return records.update(args.id, {
        email: args.email,
        token: args.token,
        status: args.status,
        profileId: args.profileId,
        notes: args.notes,
      })
    case 'antig_records_upsert':
      return records.upsert({
        id: args.id,
        email: args.email,
        token: args.token,
        status: args.status,
        profileId: args.profileId,
        notes: args.notes,
      })
    case 'antig_records_delete':
      return records.remove(args.id)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function textResult(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

async function handle(message) {
  const { id, method, params } = message
  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
        break
      case 'notifications/initialized':
      case 'notifications/cancelled':
        break
      case 'ping':
        reply(id, {})
        break
      case 'tools/list':
        reply(id, { tools: TOOLS })
        break
      case 'tools/call': {
        try {
          const result = await callTool(params?.name, params?.arguments || {})
          reply(id, textResult(result))
        } catch (error) {
          reply(id, textResult(error?.message || String(error), true))
        }
        break
      }
      default:
        if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`)
    }
  } catch (error) {
    if (id !== undefined) replyError(id, -32603, error?.message || String(error))
  }
}

const input = readline.createInterface({ input: process.stdin })

input.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  void handle(message)
})
