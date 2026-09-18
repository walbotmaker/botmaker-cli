const path = require('path');
const { __ } = require('./i18n');
const jwt = require('jsonwebtoken');
const { getAllCas, getCustomerContext } = require('./bmService')
const fse = require('fs-extra');
const { getBmc, saveContext } = require('./bmcConfig');
const getWorkspacePath = require('./getWorkspacePath');

const setCustomer = async (pwd, customerId) => {
  const wpPath = await getWorkspacePath(pwd)
  const {token} = await getBmc(wpPath); 
  console.log(__('loading context...'));
  const contextReq = await (async () => {
    try {
      return await getCustomerContext(token, customerId);
    } catch (e) {
      console.error(__('Could not find a context for customer id = %s', customerId))
      throw e;
    }
  })();
  const context = JSON.parse(contextReq.body)
  await saveContext(wpPath, context);
  const name = ((context.userData.FIRST_NAME || "") + " " + (context.userData.LAST_NAME || "")).trim();
  console.log(__('now you are: %s', name || customerId));
}

module.exports = setCustomer;