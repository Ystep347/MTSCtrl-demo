import {sqliteTable,integer,text,index,uniqueIndex,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const imports=sqliteTable('incident_imports',{
 id:text('id').primaryKey(),version:integer('version').notNull(),revision:text('revision').notNull(),
 sourceName:text('source_name').notNull(),at:integer('at').notNull(),actorId:text('actor_id').notNull(),actorName:text('actor_name').notNull(),
 recordCount:integer('record_count').notNull(),summaryJson:text('summary_json').notNull(),rawJson:text('raw_json').notNull()
},t=>[uniqueIndex('incident_imports_version_uq').on(t.version)]);
export const state=sqliteTable('incident_state',{
 id:integer('id').primaryKey(),version:integer('version').notNull(),revision:text('revision').notNull(),rawJson:text('raw_json').notNull(),
 updatedAt:integer('updated_at').notNull(),sourceName:text('source_name').notNull(),importId:text('import_id').notNull().references(()=>imports.id),lastSourceRevision:text('last_source_revision')
},t=>[check('incident_state_singleton',sql`${t.id} = 1`)]);
export const events=sqliteTable('incident_events',{
 seq:integer('seq').primaryKey({autoIncrement:true}),id:text('id').notNull(),importId:text('import_id').notNull().references(()=>imports.id),
 incidentId:text('incident_id'),kind:text('kind').notNull(),title:text('title').notNull(),detail:text('detail').notNull(),at:integer('at').notNull(),changesJson:text('changes_json').notNull().default('[]')
},t=>[uniqueIndex('incident_events_id_uq').on(t.id),index('incident_events_incident_seq_idx').on(t.incidentId,t.seq)]);

export const appUsers=sqliteTable('app_users',{
 id:text('id').primaryKey(),username:text('username').notNull(),displayName:text('display_name').notNull(),passwordHash:text('password_hash').notNull(),role:text('role').notNull().default('coordinator'),disabled:integer('disabled').notNull().default(0),createdAt:integer('created_at').notNull()
},t=>[uniqueIndex('app_users_username_uq').on(t.username),check('app_users_role_check',sql`${t.role} IN ('coordinator','editor')`)]);
export const appSessions=sqliteTable('app_sessions',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>appUsers.id,{onDelete:'cascade'}),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('app_sessions_expiry_idx').on(t.expiresAt),index('app_sessions_user_idx').on(t.userId)]);
export const authLimits=sqliteTable('auth_limits',{
 key:text('key').primaryKey(),count:integer('count').notNull(),resetAt:integer('reset_at').notNull()
},t=>[index('auth_limits_reset_idx').on(t.resetAt)]);
export const aiSettings=sqliteTable('app_ai_settings',{
 id:integer('id').primaryKey(),ciphertext:text('ciphertext').notNull(),iv:text('iv').notNull(),updatedAt:integer('updated_at').notNull(),updatedBy:text('updated_by').notNull()
},t=>[check('app_ai_settings_singleton',sql`${t.id} = 1`)]);
