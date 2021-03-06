#pragma once
#include <eosio/eosio.hpp>

#define SIGN_DAPPSERVICE_SKIP_HELPER true

#define SIGN_DAPPSERVICE_ACTIONS_MORE() \
SVC_RESP_SIGN(signtrx)(std::string id, std::string destination, std::string trx_data, std::string chain, std::string chain_type, std::string sigs, std::string account, uint16_t sigs_required, std::string trx_id, name current_provider){ \
    print(id);\
    print('\n');\
    print(destination);\
    print('\n');\
    print(trx_data);\
    print('\n');\
    print(chain);\
    print('\n');\
    print(chain_type);\
    print('\n');\
    print(sigs);\
    print('\n');\
    print(account);\
    print('\n');\
    print(sigs_required);\
    print('\n');\
    print(trx_id);\
    print('\n');\
} \
SVC_RESP_SIGN(sgcleanup)(uint64_t id, name current_provider){ \
} 