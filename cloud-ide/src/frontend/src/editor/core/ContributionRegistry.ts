// Collects the UI surfaces that plugins contribute at boot (menus + activity-bar
// panels), then hands them to the already-prop-driven TopNavBar / ActivityBar.
//
// Deliberately small: menus + activity items are the only consumers today. Add
// command/keybinding/panel-content contribution here when something consumes it,
// not before. ponytail: no dead extension points.
import {
  IContributionRegistry,
  TopMenuCategory,
  ActivityBarItem,
  IEditorPlugin,
} from '../types/editor';

export class ContributionRegistry implements IContributionRegistry {
  private menus: TopMenuCategory[] = [];
  private activityItems: ActivityBarItem[] = [];

  registerMenu(menu: TopMenuCategory): void {
    this.menus.push(menu);
  }

  registerActivityItem(item: ActivityBarItem): void {
    this.activityItems.push(item);
  }

  getMenus(): TopMenuCategory[] {
    return this.menus;
  }

  getActivityItems(): ActivityBarItem[] {
    return this.activityItems;
  }

  /** Apply plugins in order; later plugins append after earlier ones. */
  static from(plugins: IEditorPlugin[]): ContributionRegistry {
    const reg = new ContributionRegistry();
    plugins.forEach((p) => p.contribute(reg));
    return reg;
  }
}
