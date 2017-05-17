
import NonTerminal from "../lexing/rules/util/NonTerminal";
import Terminal from "../lexing/rules/util/Terminal";
import RulesParser from "./../lexing/rules/RulesParser";
import Rule from "./../lexing/rules/util/Rule";
import { start } from "repl";
import Token from "../../lib/lexing/util/Token";

import Lexer from './../lexing/Lexer';
import Tag from './../lexing/util/Tag';
import { runInNewContext } from "vm";
import Condition from "./util/Condition";
import Item from "./util/Item";


const START_NON_TERMINAL = new NonTerminal('S');
const EOF_TERMINAL = new Terminal('EOF');

const TERMINALS = Object.keys(Tag).map(key => new Terminal(Tag[key]));


function ThrowParseError(config) {
	Object.keys(config).map(key => config[key]).forEach(val => {console.log(val)});
	throw new Error('Parse error');
}



// SHIFT
// REDUCE
// ACCEPT
// ERROR
function ACTION(cond: Condition, token: Token) {

}









export class Parser {

	private rules: Rule[];
	private tokens: Token[];
	private grammarSymbols: Array<Terminal|NonTerminal>;

	private FSM;
	private canonicalSet;

	constructor(rules: Rule[], tokens: Token[], grammarSymbols: Array<Terminal|NonTerminal>) {
		this.rules = rules;
		this.grammarSymbols = grammarSymbols;
		this.tokens = tokens;
		this.FSM = {};
	}



	FIRST(X: NonTerminal): Terminal[] {
		let result: Terminal[] = [];

		this.rules.forEach(rule => {
			// Rules X = ...
			if (rule.lhs.equals(X)) {

				let firstElement = rule.rhs[0];

				if (firstElement instanceof Terminal) {
					result.push(firstElement);
				}
				else if (firstElement instanceof NonTerminal) {
					result = result.concat(this.FIRST(firstElement));
				}
			}
		});
		return result;
	}



	FOLLOW(X: NonTerminal): Terminal[] {

		if (X.equals(START_NON_TERMINAL)) {
			return [EOF_TERMINAL];
		}


		let result: Terminal[] = [];

		this.rules.forEach(rule => {
			let rhsLen = rule.rhs.length;

			rule.rhs.forEach((elem, index) => {
				if (elem instanceof NonTerminal && elem.equals(X)) {

					// Rule Y = ... X ...
					if (index < rhsLen - 1) {

						let nextElem = rule.rhs[index + 1];

						if (nextElem instanceof Terminal) {
							result.push(nextElem);
						}
						else if (nextElem instanceof NonTerminal) {
							result = result.concat(this.FIRST(nextElem));
						}

					}

					// Rule Y = ... X
					if (index === rhsLen - 1) {
						result = result.concat(this.FOLLOW(rule.lhs));
					}
				}
			});
		});
		return result;
	}


	CLOSURE(items: Item[]): Item[] {

		let closure: Item[] = items;

		let newItems = [];

		do {
			newItems = [];

			closure.forEach(item => {

				// A -> a.Bb
				let nextElem = item.rule.rhs[item.marker];

				if (nextElem instanceof NonTerminal) {

					this.rules.forEach((rule: Rule, index) => {

						if (nextElem.equals(rule.lhs)) {

							let isAlreadyAdded = closure.filter(item => {
								return item.rule.equals(rule)
									&& item.marker === 0;
							}).length > 0;

							if (!isAlreadyAdded) {
								newItems.push(new Item(rule, 0));
							}
						}
					})
				}
			});

			closure = closure.concat(newItems);

		} while (newItems.length > 0);

		return closure;
	}


	GOTO(items: Item[], nextElem: Terminal | NonTerminal) {

		let nextBasisItems = items.filter(item => {
				let nextRuleElem = item.rule.rhs[item.marker];

				return nextRuleElem && nextRuleElem.equals(nextElem);
			})
			.map(item => new Item(item.rule, item.marker + 1));

		return this.CLOSURE(nextBasisItems);
	}



	buildCanonicalSet() {
		let that = this;

		// стартовое состояние
		// массив пунктов
		let startRule = this.rules[0];
		let startItem = new Item(startRule, 0);
		let startClosure = this.CLOSURE([startItem]);
		let startCondition = new Condition(startClosure);

		let resultConditions = [startCondition];
		let currentConditions = [];
		let newConditionsCount = 1;

		while(newConditionsCount > 0) {
			currentConditions = resultConditions.slice(0);
			newConditionsCount = 0;

			currentConditions.forEach(cond => {
				let items = cond.getItems();

				that.grammarSymbols.forEach(symbol => {
					let gotoItems = that.GOTO(items, symbol);

					if (gotoItems.length > 0) {

						let foundCond = resultConditions.filter(resultCond => {
							return resultCond.itemsEqual(gotoItems);
						})[0];

						if (!foundCond) {
							let newCond = new Condition(gotoItems, symbol);
							resultConditions.push(newCond);

							newConditionsCount += 1;
						}
					}
				})
			})
		}

		this.canonicalSet = resultConditions;
	}




	buildFSMTable() {
		let that = this;

		this.canonicalSet.forEach(state => {

			let items = state.getItems();

			items.forEach(item => {

				// REDUCE Item X -> ...·
				if (item.marker === item.rule.rhs.length) {

					// Check start rule S -> ...·
					if (item.rule.lhs.equals(START_NON_TERMINAL)) {

						that.addToFSM(
							state.getIndex(),
							EOF_TERMINAL,
							{
								operation: 'SUCCESS',
								state: state,
								symbol: EOF_TERMINAL,
								item: item
							}
						);
					}
					else {
						that.FOLLOW(item.rule.lhs).forEach(symbol => {
							that.addToFSM(
								state.getIndex(),
								symbol,
								{
									operation: 'REDUCE',
									state: state,
									symbol: symbol,
									item: item,

									rule: item.rule
								}
							);
						});
					}
				}
				// SHIFT Item X -> ...·(a|A)...
				else {
					let nextElem = item.rule.rhs[item.marker];

					let nextItems = that.GOTO(state.getItems(), nextElem);

					let foundState = that.canonicalSet.filter(state => {
						return state.itemsEqual(nextItems);
					})[0];

					if (!foundState) {
						ThrowParseError({
							message: "Unknown goto state",
							state: state,
							nextElem: nextElem
						});
					}
					else {
						that.addToFSM(
							state.getIndex(),
							nextElem,
							{
								operation: 'SHIFT',
								state: state,
								symbol: nextElem,
								item: item,

								nextState: foundState
							}
						)
					}
				}
			});
		})
	}




	parse() {

		this.buildCanonicalSet();

		this.buildFSMTable();

		console.log(42);

		let startCondIndex = 0;
		let startCond = this.canonicalSet[0];
		let stack = [startCond];


		while (true) {
			let cond = stack[stack.length - 1];
			let token = this.tokens[0];
			let terminal = new Terminal(token.getTag());

			let action = this.getFromFSM(cond.getIndex(), terminal);

			if (!action) {
				ThrowParseError({
					message: 'LR error on step',
					stack: JSON.stringify(stack.map(x => x.getIndex()).join()),
					tokens: JSON.stringify(this.tokens)
				});
			}

			else if (action.description.operation === 'SHIFT') {

				console.log('SHIFT');
				console.log(JSON.stringify(action.description.item));
				console.log(stack.map(x => x.getIndex()).join());

				this.tokens = this.tokens.slice(1);
				stack.push(action.description.nextState);

				console.log(JSON.stringify(action.description.nextState));
			}

			else if (action.description.operation === 'REDUCE') {

				console.log('REDUCE');
				console.log(JSON.stringify(action.description.item));
				console.log(stack.map(x => x.getIndex()).join());

				let length = action.description.rule.rhs.length;

				stack = stack.slice(0, -length);

				let topState = stack[stack.length - 1];

				let actionAfterReduce = this.getFromFSM(topState.getIndex(), action.description.rule.lhs);
				stack.push(actionAfterReduce.description.nextState);
			}

			else if (action.description.operation === 'SUCCESS') {
				console.log('SUCCESS');
				break;
			}

			else {
				ThrowParseError({
					message: 'Unknown LR step type'
				});
			}
		}
	}


	// UTIL:
	addToFSM(index: number, symbol: Terminal | NonTerminal, value: any) {
		if (!this.FSM[index]) {
			this.FSM[index] = [];
		}
		this.FSM[index].push({
			symbol: symbol,
			description: value
		});
	}
	getFromFSM(index: number, symbol: Terminal | NonTerminal) {
		return this.FSM[index].filter(op => {
			return op.symbol.equals(symbol);
		})[0];
	}

}
