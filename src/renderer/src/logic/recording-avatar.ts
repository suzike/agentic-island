export interface StoredRecordingAvatar {
  name: string
  dataUrl: string
  updatedAt: number
}

const DB_NAME = 'agentic-island-recording-assets'
const STORE_NAME = 'avatars'
const AVATAR_KEY = 'active-avatar'

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('无法打开录屏素材库'))
})

export async function saveRecordingAvatar(asset: StoredRecordingAvatar): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(asset, AVATAR_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('保存头像失败'))
      transaction.onabort = () => reject(transaction.error || new Error('保存头像已中止'))
    })
  } finally { db.close() }
}

export async function loadRecordingAvatar(): Promise<StoredRecordingAvatar | null> {
  const db = await openDb()
  try {
    return await new Promise<StoredRecordingAvatar | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(AVATAR_KEY)
      request.onsuccess = () => resolve((request.result as StoredRecordingAvatar | undefined) || null)
      request.onerror = () => reject(request.error || new Error('读取头像失败'))
    })
  } finally { db.close() }
}

export async function deleteRecordingAvatar(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(AVATAR_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('删除头像失败'))
    })
  } finally { db.close() }
}
