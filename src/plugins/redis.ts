import type { FastifyPluginCallback } from 'fastify'
import Redis from 'ioredis'
import { FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { App } from '../server'
import { ProjectConfig, KeyIDs, getProjectKey } from '../exports'

export interface RedisDecoration {
  ingress: Redis.Redis
  rateLimit: Redis.Redis
}

const redisPlugin: FastifyPluginCallback = (app, _, next) => {
  const ingress = new Redis(process.env.REDIS_URI_INGRESS)
  ingress.on('error', error => {
    app.log.error({
      msg: `Redis error`,
      plugin: 'redis',
      instance: 'ingress',
      error
    })
    ;(app as App).sentry.report(error, undefined, {
      tags: {
        redis: 'ingress'
      }
    })
  })
  const decoration: RedisDecoration = {
    ingress,
    rateLimit: new Redis(process.env.REDIS_URI_RATE_LIMIT)
  }
  app.decorate('redis', decoration)
  next()
}

export default fp(redisPlugin)

// --

export async function getProjectConfig(
  projectID: string,
  app: App,
  req?: FastifyRequest
): Promise<ProjectConfig | null> {
  const configKey = getProjectKey(projectID, KeyIDs.config)
  try {
    const json = await app.redis.ingress.get(configKey)
    if (!json) {
      throw new Error('Project configuration not found')
    }
    return JSON.parse(json)
  } catch (error) {
    req?.log.warn({
      err: error,
      projectID,
      configKey
    })
    app.sentry.report(error, req, {
      tags: {
        projectID,
        configKey
      }
    })
    return null
  }
}

export function checkRedisHealth(instance: Redis.Redis, name: string) {
  const whitelist = ['connect', 'ready', 'connecting', 'reconnecting']
  if (!whitelist.includes(instance.status)) {
    throw new Error(`Redis status (${name}): ${instance.status}`)
  }
}

export async function closeRedisConnection(connection: Redis.Redis) {
  await connection.quit()
  return new Promise(resolve => {
    connection.on('end', resolve)
    setTimeout(() => {
      connection.disconnect()
    }, 200)
  })
}
