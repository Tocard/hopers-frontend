import {
	SigningCosmWasmClient,
	MsgExecuteContractEncodeObject,
} from "@cosmjs/cosmwasm-stargate";
import { toUtf8 } from "@cosmjs/encoding";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { GasPrice } from "@cosmjs/stargate";
import { coins } from "@cosmjs/proto-signing";
import { Coin } from "@cosmjs/launchpad";
import {
	useWallet,
	// useWalletManager
} from "@noahsaso/cosmodal";
import { useCallback, useContext } from "react";
import { useSelector } from "react-redux";
// import {
//   // useAppSelector
// } from "../app/hooks";
// import Collections, {
//   MarketplaceContracts,
//   MarketplaceInfo,
//   MintContracts,
// } from "../constants/Collections";
// import {
//   importContract,
//   // contractAccounts,
//   // deleteAccount,
// } from "../features/accounts/accountsSlice";
import { toMicroAmount } from "../util/coins";
import { TokenStatus, TokenType } from "../types/tokens";
import { ChainConfigs, ChainTypes } from "../constants/ChainTypes";
import { CosmostationWalletContext } from "../context/Wallet";

type CreateExecuteMessageArgs = {
	senderAddress: string;
	message: Record<string, Record<string, string>>;
	contractAddress: string;
	funds?: Array<Coin>;
};

export const getOfflineSigner = async (chainId: string) => {
	if (window.keplr) {
		await window.keplr.enable(chainId);
		let signer: any = await window.keplr.getOfflineSignerAuto(chainId);
		if (!signer) signer = await window.keplr.getOfflineSignerOnlyAmino(chainId);
		if (!signer) signer = await window.keplr.getOfflineSignerAuto(chainId);
		return signer;
	}
};

const useContract = () => {
	// const contracts = useAppSelector(contractAccounts);
	// const { connect } = useWalletManager();

	const state = useSelector((state: any) => state);
	const { offlineSigner: keplrOfflineSigner } = useWallet(
		ChainConfigs[ChainTypes.JUNO].chainId
	);
	const { offlineSigner: cosmostationOfflineSigner, getJunoQueryClient } =
		useContext(CosmostationWalletContext);

	const runQuery = useCallback(
		async (contractAddress: string, queryMsg: any) => {
			const client = await getJunoQueryClient();
			const result = await client.queryContractSmart(contractAddress, queryMsg);
			return result;
		},
		[getJunoQueryClient]
	);

	const getExecuteClient = useCallback(async () => {
		const config = ChainConfigs[ChainTypes.JUNO];
		let signer = keplrOfflineSigner || cosmostationOfflineSigner;
		if (!signer) {
			signer = await getOfflineSigner(config.chainId);
		}
		if (!signer) {
			throw new Error("No account selected");
		}
		const cwClient = await SigningCosmWasmClient.connectWithSigner(
			config["rpcEndpoint"],
			signer,
			{
				gasPrice: GasPrice.fromString(
					`${config["gasPrice"]}${config["microDenom"]}`
				),
			}
		);
		return cwClient;
	}, [cosmostationOfflineSigner, keplrOfflineSigner]);

	const runExecute = useCallback(
		async (
			contractAddress: string,
			executeMsg: any,
			option?: {
				memo?: string;
				funds?: string;
				denom?: string;
			}
		) => {
			const config = ChainConfigs[ChainTypes.JUNO];
			let signer = keplrOfflineSigner || cosmostationOfflineSigner;
			if (!signer) {
				console.log("debug run execute don't have signer");
				signer = await getOfflineSigner(config.chainId);
			}
			if (!signer) {
				throw new Error("No account selected");
			}
			const account = state.accounts.keplrAccount;

			const executeMemo = option?.memo || "";
			const executeFunds = option?.funds || "";
			const executeDenom = option?.denom || "";

			const cwClient = await SigningCosmWasmClient.connectWithSigner(
				config["rpcEndpoint"],
				signer,
				{
					gasPrice: GasPrice.fromString(
						`${config["gasPrice"]}${config["microDenom"]}`
					),
				}
			);

			// return client.execute(
			//   account.address,
			//   contract.address,
			//   executeMsg,
			//   "auto",
			//   executeMemo,
			//   executeFunds
			//     ? coins(
			//         toMicroAmount(
			//           executeFunds,
			//           state.connection.config["coinDecimals"]
			//         ),
			//         state.connection.config["microDenom"]
			//       )
			//     : undefined
			// );
			return cwClient.execute(
				account.address,
				// contract.address,
				contractAddress,
				executeMsg,
				"auto",
				executeMemo,
				executeFunds
					? coins(
							toMicroAmount(
								executeFunds,
								ChainConfigs[ChainTypes.JUNO]["coinDecimals"]
							),
							executeDenom || ChainConfigs[ChainTypes.JUNO]["microDenom"]
					  )
					: undefined
			);
		},
		[state, keplrOfflineSigner, cosmostationOfflineSigner]
	);

	const getBalances = useCallback(async () => {
		const offlineSigner = keplrOfflineSigner || cosmostationOfflineSigner;
		if (!offlineSigner) return {};
		const account = state.accounts.keplrAccount;
		const config = ChainConfigs[ChainTypes.JUNO];

		const cwClient = await SigningCosmWasmClient.connectWithSigner(
			config["rpcEndpoint"],
			offlineSigner,
			{
				gasPrice: GasPrice.fromString(
					`${config["gasPrice"]}${config["microDenom"]}`
				),
			}
		);
		const denoms: { denom: TokenType; isNativeCoin: boolean }[] = [];
		const queries = (
			Object.keys(TokenType) as Array<keyof typeof TokenType>
		).map((key) => {
			const tokenStatus = TokenStatus[TokenType[key]];
			denoms.push({
				denom: TokenType[key],
				isNativeCoin: tokenStatus.isNativeCoin,
			});
			return !tokenStatus.isNativeCoin && tokenStatus.contractAddress
				? runQuery(tokenStatus.contractAddress, {
						balance: { address: account.address },
				  })
				: cwClient.getBalance(account.address, TokenType[key]);
		});
		return await Promise.all(queries)
			.then((results: any) => {
				let returnValue: { [key in TokenType]: any } = {} as {
					[key in TokenType]: any;
				};
				denoms.forEach(
					(
						denom: { denom: TokenType; isNativeCoin: boolean },
						index: number
					) => {
						const crrResult = results[index];
						returnValue[denom.denom] = {
							denom: denom.denom,
							amount: Number(
								denom.isNativeCoin ? crrResult.amount : crrResult.balance
							),
						};
					}
				);
				return returnValue;
			})
			.catch((err: any) => {
				console.error("get balance error", err);
				return {};
			});
	}, [
		keplrOfflineSigner,
		cosmostationOfflineSigner,
		runQuery,
		state.accounts.keplrAccount,
	]);

	const createExecuteMessage = useCallback(
		({
			senderAddress,
			contractAddress,
			message,
			funds,
		}: CreateExecuteMessageArgs): MsgExecuteContractEncodeObject => ({
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: MsgExecuteContract.fromPartial({
				sender: senderAddress,
				contract: contractAddress,
				msg: toUtf8(JSON.stringify(message)),
				funds: funds || [],
			}),
		}),
		[]
	);

	return {
		// initContracts,
		getBalances,
		runQuery,
		runExecute,
		createExecuteMessage,
		getExecuteClient,
	};
};

export default useContract;
