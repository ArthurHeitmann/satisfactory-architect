
export interface StateMachineDefinition<State extends string | number> {
	initialState: State;
	transitions: {
		[fromState in State]?: State[];
	};
}

export class StateMachine<State extends string | number> {
	private _currentState: State;

	constructor(private definition: StateMachineDefinition<State>) {
		this._currentState = $state(definition.initialState);
	}

	get currentState(): State {
		return this._currentState;
	}

	transitionTo(newState: State) {
		if (newState === this._currentState) {
			return;
		}
		const allowedTransitions = this.definition.transitions[this._currentState] ?? [];
		if (!allowedTransitions.includes(newState)) {
			throw new Error(`Invalid state transition from ${this._currentState} to ${newState}`);
		}
		console.log(`State transition: ${this._currentState} -> ${newState}`);
		this._currentState = newState;
	}
}
