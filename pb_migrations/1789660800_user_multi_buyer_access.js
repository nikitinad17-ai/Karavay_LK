/// <reference path="../pb_data/types.d.ts" />

// Review this migration against a backup/export of the target PocketBase 0.40.x
// instance before applying it. It creates no records and contains no credentials.
migrate((app) => {
  const userScope = [
    '@request.auth.id != ""',
    '@request.auth.collectionName = "users"',
    '@request.auth.active = true',
    '@request.auth.must_change_password = false',
  ].join(' && ')

  const users = new Collection({
    type: 'auth',
    name: 'users',
    listRule: null,
    viewRule: `${userScope} && id = @request.auth.id`,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    manageRule: null,
    authRule: 'active = true',
    fields: [
      { type: 'text', name: 'login', required: true, min: 3, max: 120 },
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'bool', name: 'active' },
      { type: 'bool', name: 'must_change_password' },
    ],
    passwordAuth: {
      enabled: true,
      identityFields: ['login'],
    },
    indexes: [
      'CREATE UNIQUE INDEX idx_users_login ON users (login COLLATE NOCASE)',
    ],
  })
  app.save(users)

  const buyers = app.findCollectionByNameOrId('buyers')
  const outlets = app.findCollectionByNameOrId('outlets')

  const userBuyers = new Collection({
    type: 'base',
    name: 'user_buyers',
    listRule: `${userScope} && user = @request.auth.id && active = true`,
    viewRule: `${userScope} && user = @request.auth.id && active = true`,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'user', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'relation', name: 'buyer', required: true, maxSelect: 1, collectionId: buyers.id, cascadeDelete: true },
      { type: 'select', name: 'role', required: true, maxSelect: 1, values: ['owner', 'manager', 'viewer'] },
      { type: 'bool', name: 'active' },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_user_buyers_user_buyer ON user_buyers (user, buyer)',
    ],
  })
  app.save(userBuyers)

  const buyerAccessRule = [
    userScope,
    'active = true',
    '@collection.user_buyers.user ?= @request.auth.id',
    '@collection.user_buyers.buyer ?= id',
    '@collection.user_buyers.active ?= true',
  ].join(' && ')

  buyers.listRule = buyerAccessRule
  buyers.viewRule = buyerAccessRule
  buyers.createRule = null
  buyers.updateRule = null
  buyers.deleteRule = null
  buyers.manageRule = null
  buyers.authRule = null
  app.save(buyers)

  const outletAccessRule = [
    userScope,
    'active = true',
    '@collection.user_buyers.user ?= @request.auth.id',
    '@collection.user_buyers.buyer ?= buyer',
    '@collection.user_buyers.active ?= true',
  ].join(' && ')

  outlets.listRule = outletAccessRule
  outlets.viewRule = outletAccessRule
  outlets.createRule = null
  outlets.updateRule = null
  outlets.deleteRule = null
  outlets.manageRule = null
  outlets.authRule = null
  app.save(outlets)
}, (app) => {
  const buyers = app.findCollectionByNameOrId('buyers')
  const outlets = app.findCollectionByNameOrId('outlets')

  buyers.listRule = null
  buyers.viewRule = '@request.auth.id != "" && @request.auth.active = true && @request.auth.must_change_password = false && active = true && (id = @request.auth.id || id = @request.auth.buyer)'
  buyers.createRule = null
  buyers.updateRule = null
  buyers.deleteRule = null
  buyers.manageRule = null
  buyers.authRule = 'active = true'
  app.save(buyers)

  outlets.listRule = '@request.auth.id != "" && @request.auth.active = true && @request.auth.must_change_password = false && active = true && must_change_password = false && buyer = @request.auth.id'
  outlets.viewRule = '@request.auth.id != "" && @request.auth.active = true && @request.auth.must_change_password = false && active = true && must_change_password = false && (buyer = @request.auth.id || id = @request.auth.id)'
  outlets.createRule = null
  outlets.updateRule = null
  outlets.deleteRule = null
  outlets.manageRule = null
  outlets.authRule = 'active = true'
  app.save(outlets)

  const userBuyers = app.findCollectionByNameOrId('user_buyers')
  app.delete(userBuyers)
  const users = app.findCollectionByNameOrId('users')
  app.delete(users)
})
