require('mocha');
const { requireBox } = require('@liquidapps/box-utils');
const { assert } = require('chai'); // Using Assert style
const { getLocalDSPEos, getCreateAccount, getNetwork } = requireBox('seed-eos/tools/eos/utils');
const { loadModels } = requireBox('seed-models/tools/models');
const getDefaultArgs = requireBox('seed-zeus-support/getDefaultArgs');
const { getCreateKeys } = requireBox('eos-keystore/helpers/key-utils');
const { getEosWrapper } = requireBox('seed-eos/tools/eos/eos-wrapper');

const artifacts = requireBox('seed-eos/tools/eos/artifacts');
const deployer = requireBox('seed-eos/tools/eos/deployer');
const { genAllocateDAPPTokens, createLiquidXMapping } = requireBox('dapp-services/tools/eos/dapp-services');
const delay = ms => new Promise(res => setTimeout(res, ms));

const contractCode = 'tokenpeg';
const contractCodeX = 'tokenpegx';
const ctrt = artifacts.require(`./${contractCode}/`);
const ctrtx = artifacts.require(`./${contractCodeX}/`);
const tokenContract = artifacts.require('./eosio.token/');

describe(`Token bridge Test`, () => {
  let testcontract, testcontractX;
  const codeXMainnet = 'testpegxm';
  const codeXSidechain = 'testpegx';
  const sidechainName = 'test1';
  const testAccMainnet = 'testpegmn';
  const testAccSidechain = 'testpegsc';
  const tokenAccMainnet = 'tpgmainnet';
  const tokenAccSidechain = 'tpgsidechain';
  let dspeos, sidechain;
  let eosconsumerX;
  let eostestMainnet, eostestSidechain;
  let tokenMainnet, tokenSidechain;
  before(done => {
    (async () => {
      try {

        // staking to 2 DSPs for the oracle and cron services for mainnet contract
        const deployedContract = await deployer.deploy(ctrt, codeXMainnet);
        // deploy token on mainnet
        const deployedTokenMainnet = await deployer.deploy(tokenContract, tokenAccMainnet);
        await getCreateAccount(testAccMainnet);
        await deployedTokenMainnet.contractInstance.create({
          issuer: tokenAccMainnet,
          maximum_supply: "1000000.0000 TKN"
        }, {
            authorization: `${tokenAccMainnet}@active`,
        });
        await deployedTokenMainnet.contractInstance.issue({
          to: testAccMainnet,
          quantity: "1000.0000 TKN",
          memo: ""
        }, {
            authorization: `${tokenAccMainnet}@active`,
        });
        await genAllocateDAPPTokens(deployedContract, "oracle", "pprovider1", "default");
        await genAllocateDAPPTokens(deployedContract, "oracle", "pprovider2", "foobar");
        await genAllocateDAPPTokens(deployedContract, "ipfs", "pprovider1", "default");
        await genAllocateDAPPTokens(deployedContract, "ipfs", "pprovider2", "foobar");
        await genAllocateDAPPTokens(deployedContract, "cron", "pprovider1", "default");
        dspeos = await getLocalDSPEos(codeXMainnet);
        testcontract = deployedContract.contractInstance;

        // staking to 2 DSPs for the oracle and cron services for side/sister chain contract
        const sidechains = await loadModels('eosio-chains');
        sidechain = sidechains.find(a => a.name === sidechainName);
        await getCreateAccount(codeXMainnet, null, false);
        await getCreateAccount(codeXSidechain, null, false, sidechain);
        const deployedContractX = await deployer.deploy(ctrtx, codeXSidechain, null, sidechain);
        testcontractX = deployedContractX.contractInstance;
        // deploy token on sidechain
        const deployedTokenSidechain = await deployer.deploy(tokenContract, tokenAccSidechain, null, sidechain);
        await deployedTokenSidechain.contractInstance.create({
          issuer: codeXSidechain,
          maximum_supply: "1000000.0000 TKN"
        }, {
            authorization: `${tokenAccSidechain}@active`,
        });
        await genAllocateDAPPTokens({ address: codeXMainnet }, 'cron', '', 'default');
        await genAllocateDAPPTokens({ address: codeXMainnet }, 'ipfs', '', 'default');
        await genAllocateDAPPTokens({ address: codeXMainnet }, 'oracle', '', 'default');
        await createLiquidXMapping(sidechain.name, codeXMainnet, codeXSidechain);

        const mapEntry = (loadModels('liquidx-mappings')).find(m => m.sidechain_name === sidechain.name && m.mainnet_account === 'dappservices');
        if (!mapEntry)
          throw new Error('mapping not found');
        const dappservicex = mapEntry.chain_account;

        // create token
        var selectedNetwork = getNetwork(getDefaultArgs(), sidechain);
        let keys = await getCreateKeys(codeXSidechain, getDefaultArgs(), false, sidechain);
        const config = {
          expireInSeconds: 120,
          sign: true,
          chainId: selectedNetwork.chainId,
          httpEndpoint: `http://localhost:${sidechain.nodeos_port}`,
          keyProvider: keys.active.privateKey
        };
        eosconsumerX = getEosWrapper({
          chainId: selectedNetwork.chainId,
          httpEndpoint: `http://localhost:${sidechain.nodeos_port}`,
          keyProvider: keys.active.privateKey
        });
        //testcontractX = await eosconsumerX.contract(codeXSidechain);

        const dappservicexInstance = await eosconsumerX.contract(dappservicex);
        try {
          await dappservicexInstance.adddsp({ owner: codeXSidechain, dsp: 'xprovider1' }, {
            authorization: `${codeXSidechain}@active`,
          });
          await dappservicexInstance.adddsp({ owner: codeXSidechain, dsp: 'xprovider2' }, {
            authorization: `${codeXSidechain}@active`,
          });
        }
        catch (e) { console.error(e) } // ??? 

        // create test account on mainnet and sidechain
        await getCreateAccount(testAccSidechain, null, false, sidechain);

        // create eos objs for test accounts to transfer tokens
        keys = await getCreateKeys(testAccSidechain, getDefaultArgs(), false, sidechain);
        eostestSidechain = getEosWrapper({
          keyProvider: keys.active.privateKey,
          httpEndpoint: `http://localhost:${sidechain.nodeos_port}`
        });
        tokenSidechain = await eostestSidechain.contract(tokenAccSidechain);

        keys = await getCreateKeys(testAccMainnet);
        eostestMainnet = getEosWrapper({
          keyProvider: keys.active.privateKey,
          httpEndpoint: 'http://localhost:13115'
        });
        tokenMainnet = await eostestMainnet.contract(tokenAccMainnet);

        // set up bridge contracts
        await testcontractX.init({
          sister_code: codeXMainnet,
          sister_chain_name: "localmainnet",
          token_contract: tokenAccSidechain,
          token_symbol: "4,TKN",
          processing_enabled: true,
          transfers_enabled: true,
          last_irreversible_block_num: 0,
          can_issue: true,
          last_received_releases_id: 0,
          last_received_receipts_id: 0,
          last_confirmed_block_id: 0,
          last_received_transfer_block_id: 0
        }, {
          authorization: `${codeXSidechain}@active`
        });
        await testcontract.init({
          sister_code: codeXSidechain,
          sister_chain_name: "test1",
          token_contract: tokenAccMainnet,
          token_symbol: "4,TKN",
          processing_enabled: true,
          transfers_enabled: true,
          last_irreversible_block_num: 0,
          can_issue: false,
          last_received_releases_id: 0,
          last_received_receipts_id: 0,
          last_confirmed_block_id: 0,
          last_received_transfer_block_id: 0
        }, {
          authorization: `${codeXMainnet}@active`
        });
        done();
      }
      catch (e) {
        done(e);
      }
    })();
  });

  it('Token peg mainnet to sidechain', done => {
    (async () => {
      try {
        let res;
        res = await dspeos.getTableRows({
          'json': true,
          'scope': testAccMainnet,
          'code': tokenAccMainnet,
          'table': 'accounts',
          'limit': 1
        });
        const prevMainnetBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        const prevSidechainBalance = 0; // no table row to check
        const transferMemo = `${testAccSidechain},test1`;
        await tokenMainnet.transfer({ 
          from: testAccMainnet,
          to: codeXMainnet,
          quantity: "2.0000 TKN",
          memo: transferMemo
        }, {
          authorization: `${testAccMainnet}@active`
        });
        await delay(80000); // sleep
        res = await dspeos.getTableRows({
          'json': true,
          'scope': testAccMainnet,
          'code': tokenAccMainnet,
          'table': 'accounts',
          'limit': 1
        });
        const postMainnetBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        res = await eosconsumerX.getTableRows({
          'json': true,
          'scope': testAccSidechain,
          'code': tokenAccSidechain,
          'table': 'accounts',
          'limit': 1
        });
        const postSidechainBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        assert.equal(prevMainnetBalance - postMainnetBalance, 2);
        assert.equal(postSidechainBalance - prevSidechainBalance, 2);
        done();
      } catch(e) {
        done(e);
      }
    })()
  });

  it('Token peg sidechain to mainnet', done => {
    (async () => {
      try {
        let res;
        res = await dspeos.getTableRows({
          'json': true,
          'scope': testAccMainnet,
          'code': tokenAccMainnet,
          'table': 'accounts',
          'limit': 1
        });
        const prevMainnetBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        res = await eosconsumerX.getTableRows({
          'json': true,
          'scope': testAccSidechain,
          'code': tokenAccSidechain,
          'table': 'accounts',
          'limit': 1
        });
        const prevSidechainBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        const transferMemo = `${testAccMainnet},localmainnet`;
        await tokenSidechain.transfer({ 
          from: testAccSidechain,
          to: codeXSidechain,
          quantity: "1.0000 TKN",
          memo: transferMemo
        }, {
          authorization: `${testAccSidechain}@active`
        });
        await delay(80000); // sleep
        res = await dspeos.getTableRows({
          'json': true,
          'scope': testAccMainnet,
          'code': tokenAccMainnet,
          'table': 'accounts',
          'limit': 1
        });
        const postMainnetBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        res = await eosconsumerX.getTableRows({
          'json': true,
          'scope': testAccSidechain,
          'code': tokenAccSidechain,
          'table': 'accounts',
          'limit': 1
        });
        const postSidechainBalance = parseInt(res.rows[0].balance.split(" ")[0]);
        assert.equal(prevSidechainBalance - postSidechainBalance, 1);
        assert.equal(postMainnetBalance - prevMainnetBalance, 1);
        done();
      } catch(e) {
        done(e);
      }
    })()
  });
});
