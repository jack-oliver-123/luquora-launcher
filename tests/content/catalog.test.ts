import { test, expect } from 'vitest'
import { CatalogService } from '../../src/main/content/catalog'
import type { ContentProject, ContentVersion } from '../../src/shared/content'

const signal = () => new AbortController().signal
const project = (id: string): ContentProject => ({ id, slug: id, title: id, body: '', description: '', project_type: 'mod', client_side: 'required', license: { id: 'MIT', name: 'MIT' } })
const version = (id: string, projectId: string, dependencies: ContentVersion['dependencies'] = []): ContentVersion => ({ id, project_id: projectId, name: id, version_number: '1', version_type: 'release', game_versions: ['1.20.1'], loaders: ['fabric'], dependencies, files: [{ filename: `${id}.jar`, url: `https://cdn.modrinth.com/${id}.jar`, size: 5, hashes: { sha512: 'a'.repeat(128) }, primary: true }] })
const instance = { id: 'instance', versionId: '1.20.1', loader: { kind: 'fabric' as const, version: '0.16.14' } }

function catalog(data: Record<string, unknown>) {
  return new CatalogService(async url => {
    const key = new URL(String(url)).pathname.replace('/v2/', '')
    if (!(key in data)) return new Response('missing', { status: 404 })
    return Response.json(data[key])
  })
}

test('required dependencies resolve once while optional dependencies are skipped', async () => {
  const dependency = { project_id: 'api', version_id: 'api-v', dependency_type: 'required' }
  const service = catalog({ 'version/main-v': version('main-v', 'main', [dependency, dependency, { ...dependency, project_id: 'extra', dependency_type: 'optional' }]), 'version/api-v': version('api-v', 'api'), 'project/main': project('main'), 'project/api': project('api') })
  const plan = await service.plan('main-v', instance, [], signal())
  expect(plan.files.map(item => item.project.id).sort()).toEqual(['api', 'main'])
})

test('pinned incompatible dependencies fail the entire plan', async () => {
  const service = catalog({ 'version/main-v': version('main-v', 'main', [{ project_id: 'api', version_id: 'api-v', dependency_type: 'required' }]), 'version/api-v': { ...version('api-v', 'api'), game_versions: ['1.19.4'] }, 'project/main': project('main'), 'project/api': project('api') })
  await expect(service.plan('main-v', instance, [], signal())).rejects.toThrow(/兼容/)
})

test('dependency cycles and server-only projects are rejected', async () => {
  const service = catalog({ 'version/main-v': version('main-v', 'main', [{ project_id: 'main', version_id: 'main-v', dependency_type: 'required' }]), 'project/main': project('main') })
  await expect(service.plan('main-v', instance, [], signal())).rejects.toThrow(/循环/)
  const server = catalog({ 'version/server': version('server', 'server'), 'project/server': { ...project('server'), client_side: 'unsupported' } })
  await expect(server.plan('server', instance, [], signal())).rejects.toThrow(/客户端/)
})

test('search facets encode query text instead of allowing facet injection', async () => {
  let requested = ''
  const service = new CatalogService(async url => { requested = String(url); return Response.json({ hits: [], total_hits: 0, offset: 20, limit: 20 }) })
  await service.search({ query: '中文 &test', kind: 'mod', gameVersion: '1.20.1', loader: 'fabric', offset: 20 }, signal())
  const parsed = new URL(requested)
  expect(parsed.searchParams.get('query')).toBe('中文 &test')
  expect(JSON.parse(parsed.searchParams.get('facets')!)).toContainEqual(['versions:1.20.1'])
})
