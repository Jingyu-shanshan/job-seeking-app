import { Component, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import type { CriterionStrength, IfUnknown } from '@jsa/shared';

/** How much one criterion counts and, when the job may not say, what an unknown does. */
@Component({
  selector: 'app-criterion-strength',
  imports: [FormField],
  template: `
    <fieldset>
      <legend>Counts as</legend>
      <label><input type="radio" value="hard" [formField]="strength()" /> Hard</label>
      <label><input type="radio" value="preference" [formField]="strength()" /> Preference</label>
      <label><input type="radio" value="off" [formField]="strength()" /> Off</label>
    </fieldset>
    @if (ifUnknown(); as unknown) {
      <fieldset>
        <legend>{{ unknownLabel() }}</legend>
        <label><input type="radio" value="to_confirm" [formField]="unknown" /> To confirm</label>
        <label><input type="radio" value="rule_out" [formField]="unknown" /> Rule out</label>
      </fieldset>
    }
  `,
  styles: `
    fieldset {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1.5rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class CriterionStrengthFields {
  readonly strength = input.required<FieldTree<CriterionStrength>>();
  readonly ifUnknown = input<FieldTree<IfUnknown>>();
  readonly unknownLabel = input('If the job does not say (when hard)');
}
