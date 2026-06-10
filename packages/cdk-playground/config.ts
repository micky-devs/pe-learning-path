import * as assert from "assert"

export const projectNs = (() => {
  const ns = process.env.PROJECT_NS
  assert.notEqual(ns, undefined, "PROJECT_NS must be defined")
  return ns as string
})()

export const getPublicIp = async (): Promise<string> => {
  const response = await fetch("https://ipinfo.io", {
    headers: { Accept: "application/json" },
  })
  const json = (await response.json()) as { ip: string }
  return json.ip
}
