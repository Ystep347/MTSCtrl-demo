import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLoginIdentifier,loginIdentifierError,registrationPasswordError} from '../lib/auth-validation.mjs';
test('Login contract preserves aliases and supports practical email addresses, including long local parts',()=>{
  for(const login of ['coordinator','team.user-2','a_b','name@example.ru','name+team@sub.example.test','a'.repeat(64)+'@example.test'])assert.equal(loginIdentifierError(login),'',login);
  assert.equal(normalizeLoginIdentifier('  NAME@Example.RU  '),'name@example.ru');
  assert.equal(normalizeLoginIdentifier(null),'');
});
test('Malformed email and alias identifiers fail without silently rewriting them',()=>{
  for(const login of ['', 'ab','1coordinator','имя','name @example.ru','@example.ru','name@','name@@example.ru','name@example','name@-example.ru','name@example..ru','.name@example.ru','name..x@example.ru','name.@example.ru','a'.repeat(65)+'@example.ru','name@'+'a'.repeat(64)+'.ru','a'.repeat(64)+'@'+('b'.repeat(63)+'.').repeat(3)+'ru'])assert.ok(loginIdentifierError(login),login);
  assert.equal(normalizeLoginIdentifier('name @example.ru'),'name @example.ru');
});
test('Password registration keeps a 10-character minimum and the bcrypt UTF-8 byte boundary',()=>{
  assert.ok(registrationPasswordError('short'));
  assert.equal(registrationPasswordError('a'.repeat(72)),'');assert.ok(registrationPasswordError('a'.repeat(73)));
  assert.equal(registrationPasswordError('я'.repeat(36)),'');assert.ok(registrationPasswordError('я'.repeat(37)));
  assert.equal(registrationPasswordError(' 12345678 '),'');
});
