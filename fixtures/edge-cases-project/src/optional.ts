import { Factory } from './factory';

export function maybe(factory?: Factory): string {
  return factory?.build() ?? 'none';
}

export function always(): string {
  return Factory.build();
}
