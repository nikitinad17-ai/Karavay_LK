routerAdd('GET', '/service/context', (e) => {
  e.response.header().set('Cache-Control', 'no-store');

  const fail = (status, code) => {
    throw {status, code};
  };
  const validId = n =>
    typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

  try {
    if (e.request.url.rawQuery)
      fail(400, 'INVALID_PARAMETERS');

    const user = e.app.findRecordById('users', e.auth.id);
    const role = user.get('role_code');

    if (!user.get('active') ||
        user.get('must_change_password') ||
        !['owner', 'manager', 'viewer'].includes(role))
      fail(403, 'ACCESS_DENIED');

    const payers = new Map();
    let complete = false;

    for (let offset = 0; offset < 10000; offset += 200) {
      const rights = e.app.findRecordsByFilter(
        'rights',
        'user = {:uid} && active = true',
        'id', 200, offset, {uid: user.id}
      );

      for (const r of rights) {
        const scope = r.get('scope');
        const kid = r.get('kis_client_id');

        if (!((scope === 'all' && kid === 0) ||
              (scope === 'client' && validId(kid))))
          fail(502, 'INVALID_RIGHT');

        const payer = e.app.findRecordById(
          'payers', r.get('payer')
        );

        if (!payer.get('active')) continue;
        if (!validId(payer.get('id_pay')))
          fail(502, 'INVALID_MAPPING');

        if (!payers.has(payer.id)) {
          payers.set(payer.id, {
            id: payer.id,
            name: String(payer.get('name_pay') || ''),
            access: 'limited'
          });
        }

        if (scope === 'all')
          payers.get(payer.id).access = 'all';
      }

      if (rights.length < 200) {
        complete = true;
        break;
      }
    }

    if (!complete) fail(502, 'TOO_MANY_RIGHTS');
    if (!payers.size) fail(403, 'ACCESS_DENIED');

    return e.json(200, {
      user: {
        name: String(user.get('name') || ''),
        role: role
      },
      payers: Array.from(payers.values())
    });

  } catch (err) {
    const status = err && [400,403,502].includes(err.status)
      ? err.status : 502;
    return e.json(status, {
      code: err && err.code ? err.code : 'CONTEXT_UNAVAILABLE'
    });
  }
}, $apis.requireAuth('users'));
