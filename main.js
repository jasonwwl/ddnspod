#!/usr/bin/env node
/* eslint-disable no-console */
const axios = require('axios');
const Qs = require('qs');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const commander = require('commander');

let { TOKEN, DOMAIN, SUB_DOMAIN } = process.env;

function connect(url, data) {
  return axios
    .post(
      url,
      Qs.stringify({
        login_token: TOKEN,
        format: 'json',
        ...data,
      }),
    )
    .then(v => v.data);
}

function getSubDomainRecord() {
  return connect(
    'https://dnsapi.cn/Record.List',
    {
      domain: DOMAIN,
      sub_domain: SUB_DOMAIN,
      record_type: 'A',
    },
  ).then(v => (v.records && v.records[0]) || null);
}

function updateDDNS(recordId, ip) {
  return connect(
    'https://dnsapi.cn/Record.Ddns',
    {
      domain: DOMAIN,
      sub_domain: SUB_DOMAIN,
      record_id: recordId,
      record_line: '默认',
      value: ip,
    },
  ).then((v) => {
    if (v.status.code !== '1') {
      throw new Error(`#${v.status.code}, ${v.status.message} (https://dnsapi.cn/Record.Ddns)`);
    }
    return v;
  });
}

function createRecord(ip) {
  return connect(
    'https://dnsapi.cn/Record.Ddns',
    {
      domain: DOMAIN,
      sub_domain: SUB_DOMAIN,
      record_line: '默认',
      record_type: 'A',
      value: ip,
    },
  ).then((v) => {
    if (v.status.code !== '1') {
      throw new Error(`#${v.status.code}, ${v.status.message}`);
    }
    return v.record;
  });
}

function getLocalIP() {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(6666, 'ns1.dnspod.net');
    client.on('data', data => resolve(data.toString()));
    client.on('error', reject);
  });
}

function getCache() {
  try {
    const content = fs.readFileSync(path.join(os.homedir(), '.ddnspod')).toString();
    if (content) {
      return JSON.parse(content);
    }
    return null;
  } catch (e) {
    return null;
  }
}

function saveCache(data) {
  const dat = Object.assign({ updated_at: new Date() }, data);
  fs.writeFileSync(path.join(os.homedir(), '.ddnspod'), JSON.stringify(dat));
}

async function run() {
  const ip = await getLocalIP();
  const cache = getCache();
  if (cache && String(cache.ip).trim() === String(ip).trim()) {
    console.log('程序最后一次执行IP与当前IP一致，无需更新。');
    return false;
  }
  let recordId = (cache && cache.id) || null;
  if (!recordId) {
    const record = await getSubDomainRecord();
    recordId = record && record.id;
    if (record && String(record.value).trim() === String(ip).trim()) {
      console.log('DNS记录IP与当前IP一致，无需更新。');
      saveCache({ ip, id: recordId });
      return false;
    }
  }
  if (recordId) {
    await updateDDNS(recordId, ip);
  } else {
    const res = await createRecord(ip);
    recordId = res.id;
  }
  saveCache({ ip, id: recordId });
  console.log(`DDNS记录更新成功 IP: ${ip}`);
  return true;
}

commander
  .version(require('./package.json').version)
  .description('本工具可以将当前外网地址更新到dnspod的解析记录上')
  .option('-t, --token <value>', '输入dnspod的token,格式为id,token')
  .option('-d, --domain [value]', '输入需要解析的域名')
  .option('-s, --subdomain [value]', '输入需要解析的子域名')
  .action(() => {
    TOKEN = commander.token;
    DOMAIN = commander.domain;
    SUB_DOMAIN = commander.subdomain;
    run().then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  });

commander.parse(process.argv);
